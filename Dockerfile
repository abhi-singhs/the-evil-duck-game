# Build the site with dev dependencies present.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Ship only the built site, the compiled game core, and the server.
FROM node:22-alpine
WORKDIR /app
ARG SOURCE_REVISION
ENV NODE_ENV=production
ENV PORT=8080
ENV SOURCE_REVISION=$SOURCE_REVISION
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
EXPOSE 8080
USER node
CMD ["node", "server/index.mjs"]
