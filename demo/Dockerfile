# Public playground image.
#
# Wraps the published app image — same binary users deploy, no rebuild — and swaps the entrypoint
# for a supervisor that seeds a throwaway vault and resets it on an interval. Pin the base tag to a
# released version so the demo can never run code older than the security fixes in it; bump on
# release. Must be >= 0.1.2 (path-traversal + stored-XSS fixes) before it is ever exposed publicly.
FROM ghcr.io/rwnalds/engram-app:0.1.2

# git is already present in the base image (used for the vault sync loop); the seed script needs it.
COPY demo/seed.sh /demo/seed.sh
COPY demo/entrypoint.sh /demo/entrypoint.sh
RUN chmod +x /demo/seed.sh /demo/entrypoint.sh

# No volume, no persisted state — the vault lives inside the container and dies with it.
ENV VAULT_DIR=/demo-vault \
    ENGRAM_DATA_DIR=/demo-data \
    RESET_INTERVAL_SECONDS=21600

EXPOSE 3000
ENTRYPOINT ["/demo/entrypoint.sh"]
