const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
const port = 3001;

const usersSheetName = 'Users'; // Sheet name for user data
const medicalSheetName = 'Medical'; // Sheet name for medical data
const bloodSheetName = 'Blood Pressure'; // Sheet name for blood pressure data
const range = 'A:Z';

const readGoogleSheet = async (sheetName) => {
    console.log('readGoogleSheet is running for sheet:', sheetName);
    try {
        const keyFilePath = process.env.KEY_FILE_PATH;
        const auth = new google.auth.GoogleAuth({
            keyFile: keyFilePath,
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        console.log('Attempting to get spreadsheet values...');
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${sheetName}!A:Z`,
        });

        console.log("Raw response data:", response.data); // ADD THIS LINE
        return response.data.values || []; // Just return the raw data
    } catch (err) {
        console.error('Error reading Google Sheet:', err);
        return [];
    }
};

const updateGoogleSheet = async (sheetName, name, weightData) => {
    try {
        const keyFilePath = process.env.KEY_FILE_PATH;
        const auth = new google.auth.GoogleAuth({
            keyFile: keyFilePath,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        // Read the sheet to find the row with the matching name in column D (index 3)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${sheetName}!A:Z`,
        });

        const data = response.data.values || [];
        const rowIndex = data.findIndex(row => row[3] === name);

        if (rowIndex === -1) {
            throw new Error(`Name "${name}" not found in column D of sheet "${sheetName}"`);
        }

        // Get the existing value in column M (index 12)
        const existingValue = data[rowIndex][12] || '';

        // Append the new weight data to the existing value
        const newValue = existingValue ? `${existingValue} | ${weightData}` : weightData;

        // Update column M (index 12) of the found row
        const updateRange = `${sheetName}!M${rowIndex + 1}`; // +1 because Google Sheets is 1-indexed
        const updateValue = [[newValue]];

        const updateResponse = await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: updateRange,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: updateValue,
            },
        });

        console.log('Update response:', updateResponse.data);
        return updateResponse.data;
    } catch (err) {
        console.error('Error updating Google Sheet:', err);
        throw err; // Re-throw the error for the API endpoint to handle
    }
};

app.get('/api/medical-data', async (req, res) => {
    try {
        const data = await readGoogleSheet(medicalSheetName);
        res.json(data);
    } catch (error) {
        console.error('Error in /api/medical-data:', error);
        res.status(500).json({ error: 'Failed to retrieve data from Google Sheet' });
    }
});

// New endpoint to fetch and filter data
app.get('/api/health-summary', async (req, res) => {
    const { search } = req.query;

    try {
        const data = await readGoogleSheet(medicalSheetName);
        let filteredData = data;

        if (search) {
            filteredData = data.filter(item => {
                const fullName = item[0] ? item[0].toLowerCase() : ''; // Check if item[0] exists
                const searchTerm = String(search).toLowerCase();
                return fullName.includes(searchTerm);
            });
        }

        res.json(filteredData);
    } catch (error) {
        console.error('Error fetching health summary:', error);
        res.status(500).json({ error: 'Failed to retrieve health summary' });
    }
});

// New endpoint to fetch blood pressure data
app.get('/api/blood-pressure-data', async (req, res) => {
    try {
        console.log('readGoogleSheet function is running');
        const data = await readGoogleSheet(bloodSheetName);
        console.log('Data from readGoogleSheet:', data);
        res.json(data);
    } catch (error) {
        console.error('Error in /api/blood-pressure-data:', error);
        res.status(500).json({ error: 'Failed to retrieve data from Google Sheet' });
    }
});

app.post('/api/login', async (req, res) => {
    console.log('Login request body:', req.body);
    const { churchID, username, password } = req.body;

    try {
        const users = await readGoogleSheet(usersSheetName);
        // Find user by comparing username (case-insensitive and whitespace-trimmed)
        const userRow = users.find(row => row[0]?.trim().toLowerCase() === username?.trim().toLowerCase());

        if (!userRow) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // Extract user data from the row
        const userData = {
            username: userRow[0],
            password: userRow[1],
            church_id: userRow[2],
        };

        console.log('User data from Google Sheet:', userData);

        if (password !== userData.password) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        if (churchID !== userData.church_id) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        res.json({ success: true, message: 'Login successful!' });
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

app.post('/api/update-weight', async (req, res) => {
    const { name, weightData } = req.body;

    try {
        await updateGoogleSheet(medicalSheetName, name, weightData);
        res.json({ success: true, message: 'Weight updated successfully' });
    } catch (error) {
        console.error('Error updating weight:', error);
        res.status(500).json({ success: false, message: 'Failed to update weight', error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});