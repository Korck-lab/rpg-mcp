import { getDb, closeDb } from './src/storage';
import { ItemRepository } from './src/storage/repos/item.repo';

try {
    console.log('Initializing DB...');
    const db = getDb(':memory:');

    console.log('Checking tables...');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    console.log('Tables:', tables);

    console.log('Creating item repo...');
    const repo = new ItemRepository(db);

    console.log('Creating item...');
    repo.create({
        id: 'test-item',
        name: 'Test Item',
        type: 'misc',
        weight: 1,
        value: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    });
    console.log('Item created successfully.');

} catch (error) {
    console.error('Error:', error);
} finally {
    closeDb();
}
