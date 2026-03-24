#!/bin/bash

# PropChain Database Restore Testing Script
# Usage: ./test-restore.sh <backup_file>

set -e

# Configuration
DATABASE_URL="${DATABASE_URL:-postgresql://postgres:password@localhost:5432/propchain}"
TEST_DB_NAME="propchain_test_restore_$(date +%s)"

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
}

# Check arguments
if [ -z "$1" ]; then
    echo "Usage: $0 <backup_file>"
    exit 1
fi

BACKUP_FILE="$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo "Error: Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Parse database URL
parse_db_url "$DATABASE_URL"

echo "=== PropChain Backup Restoration Test ==="
echo "Backup File: $BACKUP_FILE"
echo "Test Database: $TEST_DB_NAME"
echo ""

# Set password for psql/pg_restore
export PGPASSWORD="$DB_PASSWORD"

# Decompress if necessary
RESTORE_FILE="$BACKUP_FILE"
TEMP_FILE=""
if [[ "$BACKUP_FILE" == *.gz ]]; then
    echo "Decompressing backup..."
    RESTORE_FILE="$(mktemp --suffix=.dump)"
    TEMP_FILE="$RESTORE_FILE"
    gunzip -c "$BACKUP_FILE" > "$RESTORE_FILE"
fi

# Create test database
echo "Creating test database $TEST_DB_NAME..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "CREATE DATABASE $TEST_DB_NAME;"

# Function to clean up
cleanup() {
    echo "Cleaning up..."
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS $TEST_DB_NAME;"
    if [ -n "$TEMP_FILE" ] && [ -f "$TEMP_FILE" ]; then
        rm "$TEMP_FILE"
    fi
}

trap cleanup EXIT

# Restore backup to test database
echo "Restoring backup to test database..."
pg_restore \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$TEST_DB_NAME" \
    --no-owner \
    --no-privileges \
    "$RESTORE_FILE" > /dev/null 2>&1

# Run verification checks
echo "Running verification checks..."

# Check 1: Can we connect?
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TEST_DB_NAME" -c "SELECT 1;" > /dev/null

# Check 2: Check for essential tables (e.g., users)
TABLE_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TEST_DB_NAME" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';")
echo "Found $TABLE_COUNT tables in restored database."

if [ "$TABLE_COUNT" -lt 5 ]; then
    echo "ERROR: Too few tables found ($TABLE_COUNT). Restore might have failed."
    exit 1
fi

# Check 3: Check data in key tables
# We use -t to get only the value
USER_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TEST_DB_NAME" -t -c "SELECT count(*) FROM \"users\";" | xargs)
PROPERTY_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TEST_DB_NAME" -t -c "SELECT count(*) FROM \"properties\";" | xargs)

echo "Restored User Count: $USER_COUNT"
echo "Restored Property Count: $PROPERTY_COUNT"

echo ""
echo "=== Restoration Test Successful ==="
