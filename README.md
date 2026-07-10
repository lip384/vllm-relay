# dev
use dev container with the docker image there

# prod
build docker image
```bash
podman build -t vllm-relay .
```

Run client-side docker image to get a local openai endpoint. Traffic is relayed to private remote endpoint.
```bash
podman run --rm \
    --name vllm-relay-client-side \
    -p 3000:3000 \
    --env-file .env \
    vllm-relay
```

Run server-side docker image that connects to Azure Relay and makes a local openai endpoint accessible for authenticated Azure Relay clients. 
```bash
podman run --rm \
    --name vllm-relay-server-side \
    --env-file .env \
    vllm-relay \
    server-side-proxy.js
```

Or run as deamon with -d.