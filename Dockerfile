FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY corpus ./corpus
COPY public ./public
COPY server.mjs ./
ENV NODE_ENV=production
EXPOSE 4180
CMD ["node", "server.mjs"]
