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

// Helper function to convert column index to letter
function columnToLetter(column) {
    let temp, letter = '';
    while (column > 0) {
        temp = (column - 1) % 26;
        letter = String.fromCharCode(temp + 65) + letter;
        column = (column - temp - 1) / 26;
    }
    return letter;
}

const readGoogleSheet = async (sheetName) => {
    console.log('readGoogleSheet is running for sheet:', sheetName);
    try {
        const keyFilePath = process.env.KEY_FILE_PATH;
        const auth = new google.auth.GoogleAuth({
            keyFile: keyFilePath,
            scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        // 1. Get the first row to determine the last column with data
        const firstRowResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${sheetName}!1:1`, // Read only the first row
        });

        const firstRowValues = firstRowResponse.data.values || [];
        const lastColumnIndex = firstRowValues[0]?.length || 1; // Get the number of columns in the first row

        // Convert the column index to a letter (e.g., 26 becomes "Z", 27 becomes "AA")
        const lastColumnLetter = columnToLetter(lastColumnIndex);

        // 2. Construct the dynamic range
        const dynamicRange = `${sheetName}!A:${lastColumnLetter}`;
        console.log("Dynamic Range:", dynamicRange);

        // 3. Get all the data within the dynamic range
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: dynamicRange,
        });

        console.log("Raw response data:", response.data);
        return response.data.values || [];
    } catch (err) {
        console.error('Error reading Google Sheet:', err);
        return [];
    }
};

const updateGoogleSheet = async (sheetName, name, data, column) => {
    try {
        const keyFilePath = process.env.KEY_FILE_PATH;
        const auth = new google.auth.GoogleAuth({
            keyFile: keyFilePath,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });

        // 1.  Determine the last column with data (up to a reasonable limit)
        const lastColumnLetter = 'AZ'; // Set a reasonable limit
        const dynamicRange = `${sheetName}!A:${lastColumnLetter}`;

        // Read the sheet to find the row with the matching name in column D (index 3)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: dynamicRange,
        });

        const values = response.data.values || [];
        // Ensure name is defined before using it
        if (!name) {
            throw new Error(`Name is undefined.  Check the incoming request data.`);
        }
        const rowIndex = values.findIndex(row => row[3] === name);

        if (rowIndex === -1) {
            throw new Error(`Name "${name}" not found in column D of sheet "${sheetName}"`);
        }

        // Get the existing value in the specified column
        const existingValue = values[rowIndex][column] || '';

        // Append the new data to the existing value
        const newValue = existingValue ? `${existingValue} | ${data}` : data;

        // Update the specified column of the found row
        const columnLetterUpdate = columnToLetter(column + 1); // Use helper function here
        const rowNumber = rowIndex + 1;
        const updateRange = `${sheetName}!${columnLetterUpdate}${rowNumber}`;

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
    const weightColumn = 12; // Column M

    try {
        await updateGoogleSheet(medicalSheetName, name, weightData, weightColumn);
        res.json({ success: true, message: 'Weight updated successfully' });
    } catch (error) {
        console.error('Error updating weight:', error);
        res.status(500).json({ success: false, message: 'Failed to update weight', error: error.message });
    }
});

app.post('/api/update-height', async (req, res) => {
    const { name, heightData } = req.body;
    const heightColumn = 13; // Column N

    try {
        await updateGoogleSheet(medicalSheetName, name, heightData, heightColumn);
        res.json({ success: true, message: 'Height updated successfully' });
    } catch (error) {
        console.error('Error updating height:', error);
        res.status(500).json({ success: false, message: 'Failed to update height', error: error.message });
    }
});

app.post('/api/update-blood-pressure', async (req, res) => {
    const { name, bloodPressureData } = req.body;
    const bloodPressureColumn = 15; // Column P

    try {
        await updateGoogleSheet(medicalSheetName, name, bloodPressureData, bloodPressureColumn);
        res.json({ success: true, message: 'Blood Pressure updated successfully' });
    } catch (error) {
        console.error('Error updating blood pressure:', error);
        res.status(500).json({ success: false, message: 'Failed to update blood pressure', error: error.message });
    }
});

app.post('/api/update-pulse-rate', async (req, res) => {
    const { name, pulseRateData } = req.body;
    const pulseRateColumn = 16; // Column Q

    try {
        await updateGoogleSheet(medicalSheetName, name, pulseRateData, pulseRateColumn);
        res.json({ success: true, message: 'Pulse Rate updated successfully' });
    } catch (error) {
        console.error('Error updating pulse rate:', error);
        res.status(500).json({ success: false, message: 'Failed to update pulse rate', error: error.message });
    }
});

app.post('/api/update-oxygen', async (req, res) => {
    const { name, oxygenData } = req.body;
    const oxygenColumn = 17; // Column R

    try {
        await updateGoogleSheet(medicalSheetName, name, oxygenData, oxygenColumn);
        res.json({ success: true, message: 'Oxygen updated successfully' });
    } catch (error) {
        console.error('Error updating oxygen:', error);
        res.status(500).json({ success: false, message: 'Failed to update oxygen', error: error.message });
    }
});

app.post('/api/update-temperature', async (req, res) => {
    const { name, temperatureData } = req.body;
    const temperatureColumn = 18; // Column S

    try {
        await updateGoogleSheet(medicalSheetName, name, temperatureData, temperatureColumn);
        res.json({ success: true, message: 'Temperature updated successfully' });
    } catch (error) {
        console.error('Error updating temperature:', error);
        res.status(500).json({ success: false, message: 'Failed to update temperature', error: error.message });
    }
});

app.post('/api/update-blood-sugar', async (req, res) => {
    const { name, bloodSugarData } = req.body;
    const bloodSugarColumn = 19; // Column T

    try {
        await updateGoogleSheet(medicalSheetName, name, bloodSugarData, bloodSugarColumn);
        res.json({ success: true, message: 'Blood Sugar updated successfully' });
    } catch (error) {
        console.error('Error updating blood sugar:', error);
        res.status(500).json({ success: false, message: 'Failed to update blood sugar', error: error.message });
    }
});

app.post('/api/update-gp', async (req, res) => {
    const { name, gpData } = req.body;
    const gpColumn = 20; // Column U

    try {
        await updateGoogleSheet(medicalSheetName, name, gpData, gpColumn);
        res.json({ success: true, message: 'GP updated successfully' });
    } catch (error) {
        console.error('Error updating gp:', error);
        res.status(500).json({ success: false, message: 'Failed to update gp', error: error.message });
    }
});

app.post('/api/update-allergy', async (req, res) => {
    const { name, allergyData } = req.body;
    const allergyColumn = 21; // Column V

    try {
        await updateGoogleSheet(medicalSheetName, name, allergyData, allergyColumn);
        res.json({ success: true, message: 'Allergy updated successfully' });
    } catch (error) {
        console.error('Error updating allergy:', error);
        res.status(500).json({ success: false, message: 'Failed to update allergy', error: error.message });
    }
});

app.post('/api/update-condition', async (req, res) => {
    const { name, conditionData } = req.body;
    const conditionColumn = 23; // Column X

    try {
        await updateGoogleSheet(medicalSheetName, name, conditionData, conditionColumn);
        res.json({ success: true, message: 'Condition updated successfully' });
    } catch (error) {
        console.error('Error updating condition:', error);
        res.status(500).json({ success: false, message: 'Failed to update condition', error: error.message });
    }
});

app.post('/api/update-alert', async (req, res) => {
    const { name, alertData } = req.body;
    const alertColumn = 22; // Column W

    try {
        await updateGoogleSheet(medicalSheetName, name, alertData, alertColumn);
        res.json({ success: true, message: 'Alert updated successfully' });
    } catch (error) {
        console.error('Error updating alert:', error);
        res.status(500).json({ success: false, message: 'Failed to update alert', error: error.message });
    }
});

app.post('/api/update-medication', async (req, res) => {
    const { name, medicationData } = req.body;
    const medicationColumn = 25; // Column Z

    try {
        await updateGoogleSheet(medicalSheetName, name, medicationData, medicationColumn);
        res.json({ success: true, message: 'Medication updated successfully' });
    } catch (error) {
        console.error('Error updating medication:', error);
        res.status(500).json({ success: false, message: 'Failed to update medication', error: error.message });
    }
});

app.post('/api/update-remarks', async (req, res) => {
    const { name, remarksData } = req.body;
    const remarksColumn = 24; // Column Y

    try {
        await updateGoogleSheet(medicalSheetName, name, remarksData, remarksColumn);
        res.json({ success: true, message: 'Remarks updated successfully' });
    } catch (error) {
        console.error('Error updating remarks:', error);
        res.status(500).json({ success: false, message: 'Failed to update remarks', error: error.message });
    }
});

app.post('/api/update-message-text', async (req, res) => {
    const { name, messageTextData } = req.body;
    const messageTextColumn = 28; // Column AC

    try {
        await updateGoogleSheet(medicalSheetName, name, messageTextData, messageTextColumn);
        res.json({ success: true, message: 'Message Text updated successfully' });
    } catch (error) {
        console.error('Error updating message text:', error);
        res.status(500).json({ success: false, message: 'Failed to update message text', error: error.message });
    }
});

app.post('/api/update-date-to-remind', async (req, res) => {
    const { name, dateToRemindData } = req.body;
    const dateToRemindColumn = 26; // Column AA

    try {
         if (!name) {
             throw new Error("Name is required in the request body");
         }
        await updateGoogleSheet(medicalSheetName, name, dateToRemindData, dateToRemindColumn);
        res.json({ success: true, message: 'Date to Remind updated successfully' });
    } catch (error) {
        console.error('Error updating date to remind:', error);
        res.status(500).json({ success: false, message: 'Failed to update date to remind', error: error.message });
    }
});

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
