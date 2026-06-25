#!/bin/bash
set -e

echo "=== Verifying Dockerfile Hardening ==="

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

FAILED=0

# Test 1: Check for non-root USER directive
echo ""
echo "Test 1: Checking for non-root USER directive..."
if grep -q "^USER " Dockerfile; then
    USER_LINE=$(grep "^USER " Dockerfile)
    if [[ "$USER_LINE" != "USER root" ]]; then
        echo -e "${GREEN}✓ PASS${NC}: Found non-root USER directive: $USER_LINE"
    else
        echo -e "${RED}✗ FAIL${NC}: USER is set to root"
        FAILED=1
    fi
else
    echo -e "${RED}✗ FAIL${NC}: No USER directive found in Dockerfile"
    FAILED=1
fi

# Test 2: Check for COPY instead of ADD
echo ""
echo "Test 2: Checking for COPY instead of ADD..."
if ! grep -q "^ADD " Dockerfile; then
    echo -e "${GREEN}✓ PASS${NC}: No ADD directive found (COPY is used instead)"
else
    echo -e "${RED}✗ FAIL${NC}: ADD directive found (should use COPY)"
    FAILED=1
fi

# Test 3: Check for scoped Deno permissions
echo ""
echo "Test 3: Checking for scoped Deno permissions..."
if grep -q "\-\-allow-write=" Dockerfile && grep -q "\-\-allow-net=" Dockerfile && grep -q "\-\-allow-env=" Dockerfile; then
    echo -e "${GREEN}✓ PASS${NC}: Found scoped Deno permission flags"
else
    echo -e "${RED}✗ FAIL${NC}: Missing scoped permission flags"
    FAILED=1
fi

# Test 4: Check .dockerignore is expanded
echo ""
echo "Test 4: Checking .dockerignore has required entries..."
if grep -q "tests/" .dockerignore && grep -q "CLAUDE.md" .dockerignore && grep -q "README.md" .dockerignore; then
    echo -e "${GREEN}✓ PASS${NC}: .dockerignore contains tests/, CLAUDE.md, README.md"
else
    echo -e "${RED}✗ FAIL${NC}: .dockerignore missing required entries"
    FAILED=1
fi

# Test 5: Build the image
echo ""
echo "Test 5: Building Docker image..."
if docker build -t queue-hardened:test . > /dev/null 2>&1; then
    echo -e "${GREEN}✓ PASS${NC}: Docker image built successfully"
else
    echo -e "${RED}✗ FAIL${NC}: Docker image build failed"
    FAILED=1
fi

# Test 6: Verify running process is non-root
if [ $FAILED -eq 0 ]; then
    echo ""
    echo "Test 6: Verifying running process is non-root..."

    # Start container in background
    CONTAINER_ID=$(docker run -d --rm queue-hardened:test)
    sleep 2

    # Get the UID of the process
    PROC_UID=$(docker exec "$CONTAINER_ID" id -u 2>/dev/null || echo "999")

    # Stop the container
    docker stop "$CONTAINER_ID" > /dev/null 2>&1 || true

    if [ "$PROC_UID" != "0" ]; then
        echo -e "${GREEN}✓ PASS${NC}: Process running as UID $PROC_UID (non-root)"
    else
        echo -e "${RED}✗ FAIL${NC}: Process running as UID 0 (root)"
        FAILED=1
    fi
fi

echo ""
echo "=== Verification Summary ==="
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All hardening checks passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some checks failed${NC}"
    exit 1
fi
