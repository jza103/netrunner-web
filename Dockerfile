# Dev image for the Vite dev server. The app itself is static files; this is only for local development.
FROM node:22
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host"]
