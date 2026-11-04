FROM postgres:18-alpine
RUN apk add --no-cache nodejs aws-cli coreutils su-exec
WORKDIR /opt/dllone
COPY ops/backup/backup_crypto.mjs /opt/dllone/backup_crypto.mjs
COPY ops/backup/backup.sh /opt/dllone/backup.sh
RUN chmod 0700 /opt/dllone/backup.sh
ENTRYPOINT ["/bin/sh", "/opt/dllone/backup.sh"]
