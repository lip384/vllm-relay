#FROM gcr.io/distroless/nodejs:latest
FROM ubuntu:latest

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
        && apt-get install -y --no-install-recommends \
            build-essential \
            git \
            curl \
            wget \
            ca-certificates \
        && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash -

RUN apt-get install -y nodejs \
        && rm -rf /var/lib/apt/lists/*

RUN echo "alias lssize='du -sh -- .[!.]* * | sort -h'" >> /home/ubuntu/.bashrc

WORKDIR /workspace

#ENTRYPOINT ["node"]
#CMD ["server-side-proxy.js"]
