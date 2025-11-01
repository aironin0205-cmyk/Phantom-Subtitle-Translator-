import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
    throw new Error('Please define the MONGODB_URI environment variable');
}

export const connectDB = async () => {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('MongoDB connected successfully.');
    } catch (err: any) {
        console.error('MongoDB connection error:', err.message);
        process.exit(1);
    }
};

const correctionSchema = new mongoose.Schema<any>({
    originalEnglish: { type: String, required: true },
    aiTranslation: { type: String, required: true },
    userCorrection: { type: String, required: true },
    jobId: { type: String, required: true, index: true },
    createdAt: { type: Date, default: Date.now },
});

export const CorrectionModel = mongoose.model('Correction', correctionSchema);
