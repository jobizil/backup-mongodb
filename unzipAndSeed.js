const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const unzipper = require('unzipper');

require('dotenv').config();

const srcUri = process.env.URI;
const destUri = process.env.DEST_URI;
async function copyCollections() {
    try {
        // Connect to source database
        const source = await mongoose.connect(srcUri, { useNewUrlParser: true, useUnifiedTopology: true });

        const sourceCollections = await source.connection.db.listCollections().toArray();
        await source.connection.close();

        const destination = await mongoose.connect(destUri, { useNewUrlParser: true, useUnifiedTopology: true });

        for (const collection of sourceCollections) {
            const sourceModel = source.models[collection.name] || source.model(collection.name, new mongoose.Schema({}, { strict: false }));
            const destinationModel = destination.models[collection.name] || destination.model(collection.name, new mongoose.Schema({}, { strict: false }));

            // Copy only new items added after the last record's id
            const lastRecordId = await destinationModel.findOne().sort({ _id: -1 }).select({ _id: 1 });
            const query = lastRecordId ? { _id: { $gt: lastRecordId._id } } : {};

            const sourceCollectionData = await sourceModel.find(query);
            if (sourceCollectionData.length) {
                const copiedData = sourceCollectionData.map(item => ({ ...item.toObject(), copied: true }));
                await destinationModel.insertMany(copiedData);
            }
        }

        console.log('All collections copied successfully! ==>');

        // Disconnect from destination database
        await destination.connection.close();
        const zipFileName = process.env.ZIP_FILE_NAME;
        const backupPath = path.join(__dirname, zipFileName);
        const extractDir = path.join(__dirname, 'backup');
        const zipStream = fs.createReadStream(backupPath);

        // Use promises to avoid callback hell
        await new Promise((resolve, reject) => {
            zipStream.on('error', reject);
            const unzipStream = unzipper.Extract({ path: extractDir });
            unzipStream.on('error', reject);
            unzipStream.on('close', resolve);
            zipStream.pipe(unzipStream);
        });

        const extractFiles = await fs.promises.readdir(extractDir);
        for (const file of extractFiles) {
            const backupPathExtract = path.join(extractDir, file);
            const isDirectory = (await fs.promises.stat(backupPathExtract)).isDirectory();
            if (isDirectory) {
                console.log(`Moving into ${ file } directory...........`);
                await seedDataFromDirectory(backupPathExtract);
            }
        }

        console.log('Data seeded successfully!');
        process.exit(0);
    } catch (err) {
        if (err.code === "EISDIR") {
            console.error('Error occurred while copying collections:', err.message);
            process.exit(1);
        }

        console.error('Error occurred:', err);
        process.exit(1);
    }
}



copyCollections();


async function seedDataFromDirectory(directoryPath) {
    const destination = await mongoose.connect(destUri, { useNewUrlParser: true, useUnifiedTopology: true });

    console.log('Connected to destination database from the seed data function...');

    const files = await fs.promises.readdir(directoryPath);

    for (const file of files) {
        const filePath = path.join(directoryPath, file);
        const isDirectory = (await fs.promises.stat(filePath)).isDirectory();
        if (isDirectory) {
            await seedDataFromDirectory(filePath);
        }

        // Get the name of the collection from the file name
        const collectionName = path.parse(file).name;

        //   Seed data into the corresponding collection
        // console.log('Seeding data into collection ' + collectionName)

        const collectionModel = destination.models[collectionName] || destination.model(collectionName, new mongoose.Schema({}, { strict: false }));

        console.log(`Seeding data from ${ file } file.`);

        // read the contents of the file and parse the JSON data to an array of objects
        const data = JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));

        // insert data into corresponding destination model
        await collectionModel.deleteMany({});
        await collectionModel.insertMany(data);
    }
} 
