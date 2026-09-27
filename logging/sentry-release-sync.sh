#!/usr/bin/env bash

# Sentry Releases Tracker & Deployment Sync Tool
# This script registers a new release in Sentry, associates git commits,
# finalizes the release, and records the deployment.

set -e

# Load environment variables if .env exists
if [ -f "../.env" ]; then
  # Load while avoiding commenting lines or syntax errors
  export $(grep -v '^#' ../.env | xargs)
elif [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "============================================="
echo "   Sentry Release Sync & Deployment Tool"
echo "============================================="

# Configuration
SENTRY_ORG="${SENTRY_ORG:-$SENTRY_ORGANIZATION}"
SENTRY_PROJECT="${SENTRY_PROJECT:-$SENTRY_PROJECT_NAME}"
SENTRY_RELEASE="${SENTRY_RELEASE:-$(git rev-parse HEAD 2>/dev/null)}"
ENVIRONMENT="${ENVIRONMENT:-${NODE_ENV:-production}}"

# Validate configuration
if [ -z "$SENTRY_AUTH_TOKEN" ]; then
  echo "❌ Error: SENTRY_AUTH_TOKEN is not set."
  exit 1
fi

if [ -z "$SENTRY_ORG" ]; then
  echo "❌ Error: SENTRY_ORG (or SENTRY_ORGANIZATION) is not set."
  exit 1
fi

if [ -z "$SENTRY_PROJECT" ]; then
  echo "❌ Error: SENTRY_PROJECT (or SENTRY_PROJECT_NAME) is not set."
  exit 1
fi

if [ -z "$SENTRY_RELEASE" ]; then
  echo "❌ Error: SENTRY_RELEASE could not be determined (no git repo or SENTRY_RELEASE variable)."
  exit 1
fi

echo "Configuration:"
echo "  Org:        $SENTRY_ORG"
echo "  Project:    $SENTRY_PROJECT"
echo "  Release:    $SENTRY_RELEASE"
echo "  Env:        $ENVIRONMENT"
echo "============================================="

# Check if sentry-cli is installed
if ! command -v sentry-cli &> /dev/null; then
  echo "⚠️  sentry-cli not found. Attempting to install..."
  curl -sL https://sentry.io/get-cli/ | bash
  if ! command -v sentry-cli &> /dev/null; then
    echo "❌ Error: Failed to install sentry-cli."
    exit 1
  fi
fi

# Export sentry-cli standard variables
export SENTRY_ORG
export SENTRY_PROJECT
export SENTRY_AUTH_TOKEN

echo "🚀 Registering new release: $SENTRY_RELEASE"
sentry-cli releases new "$SENTRY_RELEASE"

echo "📝 Associating commits..."
sentry-cli releases set-commits --auto "$SENTRY_RELEASE" || {
  echo "⚠️  Could not associate commits automatically. Continuing..."
}

echo "🏁 Finalizing release..."
sentry-cli releases finalize "$SENTRY_RELEASE"

echo "📦 Recording deployment for environment '$ENVIRONMENT'..."
sentry-cli releases deploys "$SENTRY_RELEASE" new -e "$ENVIRONMENT"

echo "✅ Sentry release and deployment successfully recorded!"
