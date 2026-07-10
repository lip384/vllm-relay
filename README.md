# Build the image
build docker image
```bash
docker build -t vllm-relay .
```

# Publish the image (optional)
With example docker registry:
```bash
az login
az acr login --name containerregistryogw302
docker tag vllm-relay containerregistryogw302.azurecr.io/vllm-relay
docker push containerregistryogw302.azurecr.io/vllm-relay
```

Run client-side docker image to get a local openai endpoint. Traffic is relayed to private remote endpoint.
```bash
docker run --rm \
    --name vllm-relay-client-side \
    -p 3000:3000 \
    --env-file .env \
    vllm-relay
```

Run server-side docker image that connects to Azure Relay and makes a local openai endpoint accessible for authenticated Azure Relay clients. 
```bash
docker run --rm \
    --name vllm-relay-server-side \
    --env-file .env \
    vllm-relay \
    server-side-proxy.js
```

Or run as deamon with -d.