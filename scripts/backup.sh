#!/bin/bash

# PropChain Database Backup Script
# Usage: ./backup.sh [backup_name]

set -e

# Configuration
BACKUP_DIR="${BACKUP_DIR:-./backups}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_NAME="${1:-propchain_backup_$TIMESTAMP}"
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:password@localhost:5432/propchain}"

# Parse DATABASE_URL
parse_db_url() {
    local url="$1"
    # Remove protocol
    url="${url#postgresql://}"
    
    # Extract user:password
    local auth="${url%%@*}"
    DB_USER="${auth%%:*}"
    DB_PASSWORD="${auth#*:}"
    
    # Extract host:port/database
    url="${url#*@}"
    local host_port="${url%%/*}"
    DB_HOST="${host_port%%:*}"
    DB_PORT="${host_port#*:}"
    
    # Extract database name (remove query params)
    DB_NAME="${url#*/}"
    DB_NAME="${DB_NAME%%\?*}"
}

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Parse database URL
parse_db_url "$DATABASE_URL"

echo "=== PropChain Database Backup ==="
echo "Timestamp: $TIMESTAMP"
echo "Database: $DB_NAME"
echo "Host: $DB_HOST:$DB_PORT"
echo "Backup Name: $BACKUP_NAME"
echo ""

# Set password for pg_dump
export PGPASSWORD="$DB_PASSWORD"

# Perform backup
echo "Creating backup..."
pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    -F c \
    -b \
    -v \
    -f "$BACKUP_DIR/$BACKUP_NAME.dump"

# Create SQL format backup as well (for readability)
echo "Creating SQL backup..."
pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --schema-only \
    -f "$BACKUP_DIR/${BACKUP_NAME}_schema.sql"

pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --data-only \
    -f "$BACKUP_DIR/${BACKUP_NAME}_data.sql"

# Calculate checksum
echo "Calculating checksum..."
sha256sum "$BACKUP_DIR/$BACKUP_NAME.dump" > "$BACKUP_DIR/$BACKUP_NAME.sha256"

# Validate backup
echo "Validating backup..."
if pg_restore -l "$BACKUP_DIR/$BACKUP_NAME.dump" > /dev/null 2>&1; then
    echo "Backup validation passed: Dump is readable."
else
    echo "ERROR: Backup validation failed: Dump is corrupted or unreadable!"
    exit 1
fi

# Compress backup
echo "Compressing backup..."
gzip -k "$BACKUP_DIR/$BACKUP_NAME.dump"

# Clean up old backups (keep last 10)
echo "Cleaning up old backups..."
cd "$BACKUP_DIR"
ls -t *.dump.gz 2>/dev/null | tail -n +11 | xargs -r rm --
ls -t *.dump 2>/dev/null | tail -n +11 | xargs -r rm --
ls -t *_schema.sql 2>/dev/null | tail -n +11 | xargs -r rm --
ls -t *_data.sql 2>/dev/null | tail -n +11 | xargs -r rm --
ls -t *.sha256 2>/dev/null | tail -n +11 | xargs -r rm --

echo ""
echo "=== Backup Complete ==="
echo "Files created:"
echo "  - $BACKUP_DIR/$BACKUP_NAME.dump"
echo "  - $BACKUP_DIR/$BACKUP_NAME.dump.gz"
echo "  - $BACKUP_DIR/${BACKUP_NAME}_schema.sql"
echo "  - $BACKUP_DIR/${BACKUP_NAME}_data.sql"
echo "  - $BACKUP_DIR/$BACKUP_NAME.sha256"
