import mongoose from 'mongoose';
import { env } from './src/config/env.js';
import { Category } from './src/models/category.model.js';

const seedCategories = async () => {
  try {
    await mongoose.connect(env.MONGO_URI);
    console.log('Connected to MongoDB');

    const categories = [
      'Reasoning Ability',
      'Quantitative Aptitude',
      'Daily Current Affairs',
    ];

    for (const name of categories) {
      const existing = await Category.findOne({ name });
      if (!existing) {
        await Category.create({
          name,
          description: `${name} category for Hacks`,
        });
        console.log(`Created category: ${name}`);
      } else {
        console.log(`Category already exists: ${name}`);
      }
    }
    console.log('Category seeding complete.');
    process.exit(0);
  } catch (error) {
    console.error('Error seeding categories:', error);
    process.exit(1);
  }
};

seedCategories();
