import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from "@google/generative-ai";
import { Pinecone } from '@pinecone-database/pinecone';
import SrtParser from 'srt-parser-2';
import { TranslationBlueprint, SrtLine, TranslatedSrtLine, Keyword, GroundedKeyword, UserGlossaryItem } from './types';

const { GEMINI_API_KEY, PINECONE_API_KEY, PINECONE_INDEX_NAME } = process.env;
if (!GEMINI_API_KEY || !PINECONE_API_KEY || !PINECONE_INDEX_NAME) {
    throw new Error("FATAL ERROR: Missing required environment variables (GEMINI, PINECONE).");
}

const pc = new Pinecone({ apiKey: PINECONE_API_KEY });
const pineconeIndex = pc.index(PINECONE_INDEX_NAME);

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

export class TranslationWorkerService {
    private readonly ai: GoogleGenerativeAI;
    private readonly embeddingModelName = 'text-embedding-004';
    private readonly flashModel = 'gemini-2.5-flash';
    private readonly proModel = 'gemini-2.5-pro';
    private readonly linesPerBatch = 15;

    constructor() {
        this.ai = new GoogleGenerativeAI(GEMINI_API_KEY);
    }

    public async generateBlueprint(
      subtitleContent: string, tone: string, userGlossary: UserGlossaryItem[],
      updateStage: (stage: string) => void
    ): Promise<TranslationBlueprint> {
        const subtitleText = this.parseSrt(subtitleContent).map(line => line.text).join('\n');
        updateStage('Phase 1a: Extracting Keywords...');
        const keywords = (await this.runJsonTool(this.flashModel, this.getPhase1A_Prompt(subtitleText))).keywords || [];
        
        updateStage('Phase 1b: Grounding Translations...');
        const groundedKeywords = (await this.runJsonTool(this.flashModel, this.getPhase1B_Prompt(keywords))).grounded_keywords || [];

        updateStage('Phase 1c: Assembling Blueprint...');
        const blueprint = await this.runJsonTool(this.proModel, this.getPhase1C_Prompt(subtitleText, tone, groundedKeywords, userGlossary));
        if (!blueprint.glossary) throw new Error("AI failed to generate a valid blueprint.");
        return blueprint;
    }

    public async executeTranslation(
      jobId: string, subtitleContent: string, tone: string, translationBrief: string,
      updateStage: (stage: string) => void
    ): Promise<string> {
        const srtLines = this.parseSrt(subtitleContent);
        
        updateStage('Indexing script for long-term memory...');
        await this.indexContent(jobId, srtLines);

        const batches: SrtLine[][] = [];
        for (let i = 0; i < srtLines.length; i += this.linesPerBatch) {
            batches.push(srtLines.slice(i, i + this.linesPerBatch));
        }

        let allTranslatedLines: TranslatedSrtLine[] = [];
        for (let i = 0; i < batches.length; i++) {
            const batch = batches[i];
            const progress = `Batch ${i + 1} of ${batches.length}`;
            
            updateStage(`Triage Agent classifying ${progress}`);
            const triageResult = await this.triageBatch(batch);

            let translatedTextLines: string[] = [];
            for (const line of batch) {
                const modelChoice = triageResult.find(t => t.id === line.sequence)?.model || 'flash';
                const modelToUse = modelChoice === 'pro' ? this.proModel : this.flashModel;

                updateStage(`Translating line ${line.sequence} with ${modelChoice.toUpperCase()} model`);
                const longTermContext = await this.queryContext(jobId, line.text);
                const translation = await this.runTextGen(modelToUse, this.getStep2_Prompt(line, longTermContext, translationBrief, tone));
                translatedTextLines.push(translation);
            }
            
            const translatedBatch: TranslatedSrtLine[] = batch.map((line, index) => ({ ...line, translatedText: translatedTextLines[index] }));
            allTranslatedLines.push(...translatedBatch);
        }

        updateStage('Cleaning up long-term memory...');
        await this.cleanupIndex(jobId);

        return this.toSrtString(allTranslatedLines);
    }
    
    private async indexContent(jobId: string, lines: SrtLine[]): Promise<void> {
        const model = this.ai.getGenerativeModel({ model: this.embeddingModelName });
        const embeddings = await model.batchEmbedContents({
            requests: lines.map(line => ({ content: { parts: [{ text: line.text }] } })),
        });
        const vectors = lines.map((line, i) => ({
            id: `${jobId}-${line.sequence}`,
            values: embeddings.embeddings[i].values,
            metadata: { jobId, text: line.text },
        }));
        for (let i = 0; i < vectors.length; i += 100) {
            await pineconeIndex.upsert(vectors.slice(i, i + 100));
        }
    }

    private async queryContext(jobId: string, text: string, topK: number = 5): Promise<string> {
        const model = this.ai.getGenerativeModel({ model: this.embeddingModelName });
        const { embedding } = await model.embedContent(text);
        const results = await pineconeIndex.query({
            vector: embedding.values,
            topK,
            filter: { jobId },
        });
        return results.matches?.map(match => (match.metadata as any)?.text).join('\n') || 'No relevant context found.';
    }

    private async triageBatch(batch: SrtLine[]): Promise<{ id: number, model: 'flash' | 'pro' }[]> {
        const prompt = this.getTriageAgentPrompt(batch);
        const result = await this.runJsonTool(this.flashModel, prompt);
        return result.classifications || [];
    }
    
    private async cleanupIndex(jobId: string): Promise<void> {
        console.log(`Cleanup for job ${jobId} would be performed here.`);
    }

    public stringifyBlueprint(blueprint: TranslationBlueprint): string {
      let brief = `**1. Plot & Theme Synthesis:**\n- Summary: ${blueprint.summary}\n- Key Themes: ${blueprint.keyPoints.join(', ')}\n\n`;
      brief += `**2. Character Persona Profiles:**\n`;
      blueprint.characterProfiles.forEach(p => { brief += `- Persona: ${p.personaName}\n  - Style: ${p.speakingStyle}\n  - Rule: ${p.voiceConsistencyRule}\n`; });
      brief += '\n**3. "World Anvil" Glossary (Sacrosanct):**\n';
      blueprint.glossary.forEach(g => { brief += `- Term: "${g.term}"\n  - Approved Persian: "${g.proposedTranslation}"\n`; });
      if (blueprint.culturalNuances && blueprint.culturalNuances.length > 0) {
          brief += `\n**4. Cultural Nuances:**\n- ${blueprint.culturalNuances.join('\n- ')}\n`;
      }
      return brief;
    }

    private async runJsonTool(modelName: string, prompt: string): Promise<any> {
        try {
            const model = this.ai.getGenerativeModel({ model: modelName, safetySettings });
            const result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            });
            return JSON.parse(result.response.text());
        } catch (error) {
            console.error(`Error running JSON tool with model ${modelName}:`, error);
            throw new Error("An internal AI error occurred while processing data.");
        }
    }

    private async runTextGen(modelName: string, prompt: string): Promise<string> {
        try {
            const model = this.ai.getGenerativeModel({ model: modelName, safetySettings });
            const result = await model.generateContent(prompt);
            return result.response.text();
        } catch (error) {
            console.error(`Error running text generation with model ${modelName}:`, error);
            throw new Error("An internal AI error occurred during translation.");
        }
    }

    private parseSrt(srtContent: string): SrtLine[] {
        const parser = new SrtParser();
        try {
            const srtArray = parser.fromSrt(srtContent);
            return srtArray.map(line => {
                const duration = (line.endTimeSeconds - line.startTimeSeconds);
                return {
                    sequence: parseInt(line.id, 10),
                    startTime: line.startTime,
                    endTime: line.endTime,
                    duration: isNaN(duration) ? 0 : duration,
                    text: line.text.replace(/<[^>]*>/g, '').trim(),
                };
            });
        } catch (error) {
            return srtContent.split('\n').map((text, index) => ({
                sequence: index + 1, startTime: '00:00:00,000', endTime: '00:00:00,000', duration: 0, text,
            }));
        }
    }
  
    private toSrtString(lines: TranslatedSrtLine[]): string {
        const parser = new SrtParser();
        const srtArray = lines.map(line => ({ id: line.sequence.toString(), startTime: line.startTime, endTime: line.endTime, text: line.translatedText }));
        return parser.toSrt(srtArray);
    }

    private getPhase1A_Prompt = (subtitle: string) => `Analyze the subtitle text. Extract technical terms, named entities, and idioms. For each, find a concise definition. Respond with a single JSON object: \`{ "keywords": [{ "term": string, "definition": string }] }\`. If none, return empty array. Text: """${subtitle}"""`;
    private getPhase1B_Prompt = (keywords: Keyword[]) => `For each English term, find 3 common Persian translations. Respond with a single JSON object: \`{ "grounded_keywords": [{ "term": string, "translations": [string] }] }\`. Terms: ${JSON.stringify(keywords)}`;
    private getPhase1C_Prompt = (subtitle: string, tone: string, groundedKeywords: GroundedKeyword[], userGlossary: UserGlossaryItem[]) => `Generate a "Translation Blueprint" JSON. Analyze the script for summary, keyPoints, characterProfiles, and culturalNuances.
    **Glossary Rules (CRITICAL):**
    1.  The User-Provided Glossary is SACROSANCT. For every term in it, its translation MUST be used as the 'proposedTranslation'.
    2.  For the remaining AI-Generated Keywords, select the best 'proposedTranslation' from its 'translations' array based on the '${tone}' tone and script context.
    3.  Justify each choice with evidence from the script.
    **User-Provided Glossary:** ${JSON.stringify(userGlossary)}
    **AI-Generated Keywords:** ${JSON.stringify(groundedKeywords)}
    **Script:** """${subtitle}"""`;
  
    private getTriageAgentPrompt = (batch: SrtLine[]) => `You are a linguistic triage agent. Classify each subtitle line's complexity. Respond with a JSON array ONLY: \`{ "classifications": [{ "id": number, "model": "flash" | "pro" }] }\`.
    - Use "pro" for lines with idioms, complex grammar, slang, or deep emotional/cultural nuance.
    - Use "flash" for simple, direct, or declarative sentences.
    Input for Classification:
    ---
    ${batch.map(l => `${l.id} | ${l.text}`).join('\n')}
    ---
    Produce the JSON output.`;

    private getStep2_Prompt = (line: SrtLine, context: string, brief: string, tone: string) => `You are a Master Transcreator. Transcreate ONLY the "Current Line" into fluent Persian, adhering to the "Project Brief" and '${tone}' tone. Use the "Long-Term Memory" for context.
Project Brief:
---
${brief}
---
Long-Term Memory (Context from script):
---
${context}
---
Current Line: "${line.text}"
---
Provide ONLY the single line of Persian transcreation.`;
}
