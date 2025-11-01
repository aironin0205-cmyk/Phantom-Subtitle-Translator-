export interface SrtLine {
  sequence: number;
  startTime: string;
  endTime: string;
  duration: number;
  text: string;
}

export interface UserGlossaryItem {
  term: string;
  translation: string;
}

export interface Correction {
  originalEnglish: string;
  aiTranslation: string;
  userCorrection: string;
  jobId: string;
  createdAt: Date;
}

export interface TranslatedSrtLine extends SrtLine {
  translatedText: string;
}
export type TranslationType = 'Transliteration' | 'Direct Translation' | 'Hybrid' | 'Common Usage' | 'Adaptation';
export interface GlossaryTerm {
  term: string;
  definition: string;
  proposedTranslation: string;
  translationType: TranslationType;
  justification: string;
  alternatives: string[];
}
export interface CharacterProfile {
  personaName: string;
  speakingStyle: string;
  voiceConsistencyRule: string;
}
export interface TranslationBlueprint {
  summary: string;
  keyPoints: string[];
  characterProfiles: CharacterProfile[];
  culturalNuances: string[];
  glossary: GlossaryTerm[];
}
export interface Keyword {
  term: string;
  definition: string;
}
export interface GroundedKeyword extends Keyword {
  translations: string[];
}
