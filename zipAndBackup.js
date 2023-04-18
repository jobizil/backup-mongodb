const fs = require('fs');
const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
const { exec } = require('child_process');
require('dotenv').config();
async function backupDatabase() {
  // Connection URI
  const uri = process.env.URI
  const db_name = process.env.DB_NAME

  const backupDir = path.join(__dirname, 'backup');

  // Create backup directory if it doesn't exist
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir);
  }

  try {
    // Connect to MongoDB server
    await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });
    console.log('Connected to MongoDB...');

    // Get a list of all collections in the database
    const collections = await mongoose.connection.db.listCollections().toArray();

    const backupPromises = collections.map(async (collection) => {
      const fileName = collection.name + '.json';
      const filePath = path.join(backupDir, fileName);
      console.log(`Downloading collection into ${ filePath }...`);

      const stream = fs.createWriteStream(filePath);
      const collectionModel = mongoose.model(collection.name, new mongoose.Schema({}, { strict: false }));
      const collectionCursor = collectionModel.find().cursor();

      let collectionsData = [];

      collectionCursor.on('data', (doc) => {
        collectionsData.push(doc);
      });

      await new Promise((resolve) => {
        collectionCursor.on('end', () => {
          stream.write(JSON.stringify(collectionsData, null, 2));
          stream.end();

          resolve();
        });
      });
    });

    // Wait for all collections to finish downloading and compress backup directory
    await Promise.all(backupPromises);

    console.log('Finished downloading collections.');

    // Compress backup directory into a zip file
    const date = new Date();
    const backupFileName = `${ db_name }-backup-${ date.getDate() }-${ date.getMonth() }-${ date.getFullYear() }.zip`;
    const backupFilePath = path.join(__dirname, backupFileName);
    await exec(`zip -r ${ backupFilePath } backup`);
    console.log('Finished creating backup file ' + backupFileName);

    // await backupToDropbox(backupFileName);

    // Delete backup directory after 10 seconds
    await new Promise((resolve) => setTimeout(resolve, 10000));

    if (fs.existsSync(backupDir)) {
      fs.rmdirSync(backupDir, { recursive: true });
      console.log(`Backup directory ${ backupDir } deleted.`);
    }

    process.exit(0);
  } catch (err) {
    console.error('Error occurred while backing up database:', err.message);
  }
}

backupDatabase();


async function backupToDropbox(backupFileName) {
  const options = {
    Authorization: `Bearer ${ process.env.DROPBOX_ACCESS_TOKEN }`,
    "Dropbox-API-Arg": JSON.stringify({
      path: `/aidms/${ backupFileName }`,
      mode: "add",
      autorename: true,
      mute: false,
      strict_conflict: false,
    }),
    "Content-Type": "application/octet-stream",
  };
  const backupPath = path.join(__dirname, backupFileName);

  // Upload backup file to Dropbox after 2 seconds
  await new Promise(resolve => setTimeout(resolve, 2000));
  const uploadResponse = await axios.post('https://content.dropboxapi.com/2/files/upload', fs.createReadStream(backupPath), { headers: options });
  console.log('Backup file uploaded to Dropbox 📩');
}

