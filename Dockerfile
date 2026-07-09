# production Dockerfile
# Stage 1: Build with full Node
FROM node:current-alpine AS build
WORKDIR /app

COPY package*.json ./

RUN npx npm-check-updates -u
RUN npm install

COPY client-side-proxy.js server-side-proxy.js ./

# Stage 2: Distroless runtime
FROM gcr.io/distroless/nodejs:latest
WORKDIR /app

COPY --from=build /app .

# default command (also can be used with server-side-proxy.js)
CMD ["client-side-proxy.js"]
