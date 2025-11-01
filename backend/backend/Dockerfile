# Use an official Node.js runtime as a parent image
FROM node:20-slim

# Set the working directory in the container
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package.json ./
COPY package-lock.json* ./

# Install app dependencies
RUN npm install

# Copy the rest of the backend source code
COPY . .

# Build the TypeScript code
RUN npm run build

# Your app binds to port 3001, so expose it
EXPOSE 3001

# The command to run your app
CMD [ "node", "dist/server.js" ]
