const express = require('express');
const { google } = require('googleapis');
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcrypt');
const twilio = require('twilio');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
// const port = process.env.PORT || 3001;
const PORT = process.env.PORT || 8080;
const accountSid = process.env.sid;
const authToken = process.env.token;
const twilioNumber = process.env.twilioNum;
const client = twilio(accountSid, authToken);

const usersSheetName = 'Users';
const medicalSheetName = 'Medical';
const bloodSheetName = 'Blood Pressure';

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

// Helper to get GoogleAuth for both local and cloud environments
// Uses keyFile only if KEY_FILE_PATH is set (local dev), otherwise uses ADC (cloud)
// function getGoogleAuth(scopes) {
//     if (process.env.KEY_FILE_PATH) {
//         return new google.auth.GoogleAuth({
//             keyFile: process.env.KEY_FILE_PATH,
//             scopes,
//         });
//     }
//     return new google.auth.GoogleAuth({
//         scopes,
//     });
// }
/**
 * Helper to get GoogleAuth for both local and cloud environments.
 * Uses keyFile only if KEY_FILE_PATH is set (local dev), otherwise uses ADC (cloud).
 * On Cloud Run, KEY_FILE_PATH should NOT be set.
 */
function getGoogleAuth(scopes) {
    if (process.env.KEY_FILE_PATH) {
        // Warn if KEY_FILE_PATH is set in production/Cloud Run
        if (process.env.K_SERVICE || process.env.K_REVISION) {
            console.warn(
                '[WARNING] KEY_FILE_PATH is set in a Cloud Run environment. This will cause errors. ' +
                'Unset KEY_FILE_PATH in your Cloud Run environment variables.'
            );
        }
        return new google.auth.GoogleAuth({
            keyFile: process.env.KEY_FILE_PATH,
            scopes,
        });
    }
    // This is the correct path for Cloud Run (uses ADC)
    return new google.auth.GoogleAuth({
        scopes,
    });
}
const readGoogleSheet = async (sheetName) => {
    console.log('readGoogleSheet is running for sheet:', sheetName);
    try {
        const auth = getGoogleAuth(['https://www.googleapis.com/auth/spreadsheets.readonly']);
        const sheets = google.sheets({ version: 'v4', auth });

        // 1. Get the first row to determine the last column with data
        const firstRowResponse = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${sheetName}!1:1`,
        });

        const firstRowValues = firstRowResponse.data.values || [];
        const lastColumnIndex = firstRowValues[0]?.length || 1;
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

const updateGoogleSheet = async (sheetName, name, data, column, dateTime = null) => {
    try {
        const auth = getGoogleAuth(['https://www.googleapis.com/auth/spreadsheets']);
        const sheets = google.sheets({ version: 'v4', auth });

        const lastColumnLetter = 'AZ';
        const dynamicRange = `${sheetName}!A:${lastColumnLetter}`;

        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: dynamicRange,
        });

        const values = response.data.values || [];
        if (!name) {
            throw new Error(`Name is undefined. Check the incoming request data.`);
        }
        const rowIndex = values.findIndex(row => row[3] === name);

        if (rowIndex === -1) {
            throw new Error(`Name "${name}" not found in column D of sheet "${sheetName}"`);
        }

        const existingValue = values[rowIndex][column] || '';

        let newValue;
        if (dateTime) {
            newValue = existingValue ? `${existingValue} | ${dateTime}` : dateTime;
        } else {
            newValue = existingValue ? `${existingValue} | ${data}` : data;
        }

        const columnLetterUpdate = columnToLetter(column + 1);
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
        throw err;
    }
};

app.get('/', (req, res) => {
    res.send('Medical Back API is running!');
});

app.get('/api/medical-data', async (req, res) => {
    try {
        const data = await readGoogleSheet(medicalSheetName);
        res.json(data);
    } catch (error) {
        console.error('Error in /api/medical-data:', error);
        res.status(500).json({ error: 'Failed to retrieve data from Google Sheet' });
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
app.post('/api/register', async (req, res) => {
    const { churchID, username, password } = req.body;

    try {
        // 1. Hash the password
        const hashedPassword = await bcrypt.hash(password, 10);

        // 2.  Store the new user data (churchID, username, hashedPassword) in the Google Sheet
        //    (You'll need to implement the logic to write to the Google Sheet here)

        // For now, just send a response indicating success
        res.status(201).json({ message: 'User registered successfully' });

    } catch (error) {
        console.error('Error during registration:', error);
        res.status(500).json({ message: 'Failed to register user' });
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
app.post('/api/update-date-time-to-remind', async (req, res) => {
      const { name, nzdtDateTime, dateTimeToRemindData } = req.body;
      const dateToRemindColumnAA = 26; // Column AA
      const dateToRemindColumnAB = 27; // Column AB

      try {
          if (!name) {
              return res.status(400).json({ success: false, message: "Name is required in the request body" });
          }

          // Format the delimited data
          const delimitedAA = nzdtDateTime ? `${nzdtDateTime} | ` : '';
          const delimitedAB = dateTimeToRemindData ? `${dateTimeToRemindData} | ` : '';

          // Update column AA with NZDT time
          await updateGoogleSheet(medicalSheetName, name, null, dateToRemindColumnAA, delimitedAA);

          // Update column AB with GMT time
          await updateGoogleSheet(medicalSheetName, name, null, dateToRemindColumnAB, delimitedAB);

          res.json({ success: true, message: 'Date and Time to Remind updated successfully' });
      } catch (error) {
          console.error('Error updating date and time to remind:', error);
          res.status(500).json({ success: false, message: 'Failed to update date and time to remind', error: error.message });
      }
  });
app.post('/api/update-time-to-remind', async (req, res) => {
    const { name, timeToRemindData } = req.body;
    const timeToRemindColumn = 27; // Column AB

    try {
        if (!name) {
            throw new Error("Name is required in the request body");
        }
        await updateGoogleSheet(medicalSheetName, name, timeToRemindData, timeToRemindColumn);
        res.json({ success: true, message: 'Time to Remind updated successfully' });
    } catch (error) {
        console.error('Error updating time to remind:', error);
        res.status(500).json({ success: false, message: 'Failed to update time to remind', error: error.message });
    }
});
app.post('/api/add-medical-data', async (req, res) => {
    console.log('Add medical data request body:', req.body);
    const { surname, firstname, middle, address, contactNo, birthday, gender, status, visaStatus, localeGroup } = req.body;

    try {

const auth = getGoogleAuth(['https://www.googleapis.com/auth/spreadsheets']);

        const sheets = google.sheets({ version: 'v4', auth });
        const spreadsheetId = process.env.GOOGLE_SHEET_ID;
        const sheetName = medicalSheetName;

        // Append the new row to the sheet
        const appendResponse = await sheets.spreadsheets.values.append({
            spreadsheetId: spreadsheetId,
            range: `${sheetName}!A1`, // Appends to the end of the sheet
            valueInputOption: 'USER_ENTERED',
            insertDataOption: 'INSERT_ROWS', // Corrected value
            resource: {
                values: [[surname, firstname, middle, '', localeGroup, birthday, '', gender, status, visaStatus, address, contactNo]], // Order matches your description
            },
        });

        console.log('Append response:', appendResponse.data);

        res.json({ success: true, message: 'Medical data added successfully' });
    } catch (error) {
        console.error('Error adding medical data:', error);
        res.status(500).json({ success: false, message: 'Failed to add medical data', error: error.message });
    }
});

app.post('/api/check-medical-data', async (req, res) => {
    const { surname, firstname, middle, birthday } = req.body;

    if (!surname || !firstname || !middle || !birthday) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        const data = await readGoogleSheet(medicalSheetName);

        const exists = data.some(row => {
            // Assuming the columns are in this order: Surname, Firstname, Middle, Birthday
            const surnameInSheet = row[0] ? row[0].toLowerCase() : '';
            const firstnameInSheet = row[1] ? row[1].toLowerCase() : '';
            const middleInSheet = row[2] ? row[2].toLowerCase() : '';
            const birthdayInSheet = row[5] ? row[5] : ''; //Birthday

            const surnameMatches = surnameInSheet === surname.toLowerCase();
            const firstnameMatches = firstnameInSheet === firstname.toLowerCase();
            const middleMatches = middleInSheet === middle.toLowerCase();
            const birthdayMatches = birthdayInSheet === birthday;

            return surnameMatches && firstnameMatches && middleMatches && birthdayMatches;
        });

        res.json({ exists: exists });
    } catch (error) {
        console.error('Error checking medical data:', error);
        res.status(500).json({ error: 'Failed to check medical data' });
    }
});

app.get('/api/get-name-list', async (req, res) => {
    try {
        const data = await readGoogleSheet(medicalSheetName);
        // Extract names from column D (index 3)
        const nameList = data.map(row => row[3]).filter(name => name); // Filter out empty names
        res.json(nameList);
    } catch (error) {
        console.error('Error fetching name list:', error);
        res.status(500).json({ error: 'Failed to fetch name list' });
    }
});

app.post('/api/update-medical-data', async (req, res) => {
    const { search, surname, firstname, middle, address, contactNo, birthday, gender, status, visaStatus, localeGroup } = req.body;

    if (!search) {
        return res.status(400).json({ error: 'Search term is required to identify the record' });
    }

    try {
        // const keyFilePath = process.env.KEY_FILE_PATH;
        // const auth = new google.auth.GoogleAuth({
        //     keyFile: keyFilePath,
        //     scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        // });
        const auth = getGoogleAuth(['https://www.googleapis.com/auth/spreadsheets']);

        const sheets = google.sheets({ version: 'v4', auth });
        const sheetName = medicalSheetName;

        // Read the sheet to find the row with the matching name in column D (index 3)
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: `${sheetName}!A:L`, // Read columns A to L
        });

        const values = response.data.values || [];
        const rowIndex = values.findIndex(row => row[3] === search);

        if (rowIndex === -1) {
            return res.status(404).json({ error: `Name "${search}" not found in column D of sheet "${sheetName}"` });
        }

        // Update the row with the new data
        const rowNumber = rowIndex + 1;
        const updateRange = `${sheetName}!A${rowNumber}:L${rowNumber}`; // Update columns A to L

        const updateValues = [[surname, firstname, middle, '', localeGroup, birthday, '', gender, status, visaStatus, address, contactNo]];

        const updateResponse = await sheets.spreadsheets.values.update({
            spreadsheetId: process.env.GOOGLE_SHEET_ID,
            range: updateRange,
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: updateValues,
            },
        });

        console.log('Update response:', updateResponse.data);
        res.json({ success: true, message: 'Medical data updated successfully' });
    } catch (error) {
        console.error('Error updating medical data:', error);
        res.status(500).json({ success: false, message: 'Failed to update medical data', error: error.message });
    }
});

app.post('/api/search-medical-data', async (req, res) => {
    const { search } = req.body;

    if (!search) {
        return res.status(400).json({ error: 'Search term is required' });
    }

    try {
        const data = await readGoogleSheet(medicalSheetName);
        const searchResult = data.filter(row => {
            // Search in columns A, B, C, and D (Surname, Firstname, Middle, Full Name)
            return row.slice(0, 4).some(cell => cell && cell.toLowerCase().includes(search.toLowerCase()));
        });
        res.json(searchResult);
    } catch (error) {
        console.error('Error searching medical data:', error);
        res.status(500).json({ error: 'Failed to search medical data' });
    }
});

app.get('/api/health-summary', async (req, res) => {
    const { search } = req.query;
    try {
        const data = await readGoogleSheet(medicalSheetName);
        let filteredData = data;
        if (search) {
            filteredData = data.filter(item => {
                const fullName = item[0] ? item[0].toLowerCase() : '';
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
    console.log('--- LOGIN DEBUG ---');
    console.log('Request body:', req.body);
    const { churchID, username, password } = req.body;

    try {
        const users = await readGoogleSheet(usersSheetName);
        console.log('Users from sheet:', users);

        // Log all usernames for comparison
        const usernames = users.map(row => row[0]);
        console.log('All usernames in sheet:', usernames);

        // Log the username being searched for
        console.log('Username to match:', username);

        const userRow = users.find(row => row[0]?.trim().toLowerCase() === username?.trim().toLowerCase());
        console.log('Matched userRow:', userRow);

        if (!userRow) {
            console.log('No user found for username:', username);
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const userData = {
            username: userRow[0],
            passwordHash: userRow[1],
            church_id: userRow[2],
        };
        console.log('User data:', userData);

        // Log the password being compared
        console.log('Password to compare:', password);
        const passwordMatch = await bcrypt.compare(password, userData.passwordHash);
        console.log('Password match:', passwordMatch);

        if (!passwordMatch) {
            console.log('Password mismatch for user:', username);
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // Log the churchID being compared
        console.log('ChurchID to compare:', churchID, 'Expected:', userData.church_id);
        if (churchID !== userData.church_id) {
            console.log('Church ID mismatch:', churchID, userData.church_id);
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        console.log('Login successful for user:', username);
        res.json({ success: true, message: 'Login successful!' });
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

app.post('/api/send-sms', async (req, res) => {
  const { to, message, dateTime } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: 'Missing "to" or "message" in request body.' });
  }

  try {
    // You can use dateTime for scheduling if you implement a scheduler (not included here)
    const result = await client.messages.create({
      body: `${message}\nScheduled for: ${dateTime}`,
      from: twilioNumber,
      to,
    });
    res.json({ success: true, sid: result.sid });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});