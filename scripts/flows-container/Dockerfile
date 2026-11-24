FROM node:22.23.5-bookworm-slim@sha256:47725aca53d3295ec2d3be8f62726599b3033cc262edc2c7e429909b3ac599fc

WORKDIR /app
COPY shared/ shared/
COPY scripts/flows-pipeline.mjs scripts/flows-quant-pipeline.mjs scripts/flows-probe-shapes.json scripts/
COPY scripts/flows-nightly/ scripts/flows-nightly/
COPY scripts/flows-legs/ scripts/flows-legs/
COPY scripts/flows-container/verify.mjs scripts/flows-container/offline.cjs scripts/flows-container/
COPY tests/flows-pipeline-golden.mjs tests/fixtures-pipeline-golden.json tests/fixtures-macro.json tests/fixtures-positioning-vendor.json tests/
COPY tests/lib/nightly-emit.mjs tests/lib/source-scan.mjs tests/lib/

USER node
ENTRYPOINT ["/usr/local/bin/node", "scripts/flows-container/verify.mjs"]
