# Use Node.js 20 base image
FROM node:20

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install --production

# Bundle app source
COPY . .

# Expose the port your app runs on (default: 8080 for Cloud Run)
EXPOSE 8080

# Start the app
CMD [ "npm", "start" ]
