#!/bin/sh
# ==============================================================================
# REVELIS COSIGN IMAGE SIGNING HELPER SCRIPT
# ==============================================================================
# This script assists in generating keypairs, signing build images, and
# verifying the signature metadata of published container tags.

set -e

COMMAND=$1
IMAGE_TAG=$2

usage() {
  echo "Usage: $0 [generate-key | sign | verify] <image-tag>"
  echo "Examples:"
  echo "  $0 generate-key"
  echo "  $0 sign ghcr.io/speedmvps/revelis-backend:latest"
  echo "  $0 verify ghcr.io/speedmvps/revelis-backend:latest"
  exit 1
}

if [ -z "$COMMAND" ]; then
  usage
fi

case "$COMMAND" in
  generate-key)
    echo "[Cosign] Generating signing key pair..."
    cosign generate-key-pair
    echo "[Cosign] Private key (cosign.key) and Public key (cosign.pub) generated."
    ;;

  sign)
    if [ -z "$IMAGE_TAG" ]; then
      echo "Error: Missing target image tag for signing."
      usage
    fi
    
    # Check if local private key exists, otherwise fallback to keyless OIDC flow
    if [ -f "cosign.key" ]; then
      echo "[Cosign] Signing image ${IMAGE_TAG} using local key (cosign.key)..."
      cosign sign --key cosign.key "${IMAGE_TAG}"
    else
      echo "[Cosign] cosign.key not found. Initiating keyless Sigstore OIDC flow..."
      # Requires ID token credentials in environment
      cosign sign --oidc-provider=github "${IMAGE_TAG}"
    fi
    echo "[Cosign] Image ${IMAGE_TAG} signed successfully!"
    ;;

  verify)
    if [ -z "$IMAGE_TAG" ]; then
      echo "Error: Missing target image tag for verification."
      usage
    fi

    if [ -f "cosign.pub" ]; then
      echo "[Cosign] Verifying image ${IMAGE_TAG} using local public key (cosign.pub)..."
      cosign verify --key cosign.pub "${IMAGE_TAG}"
    else
      echo "[Cosign] cosign.pub not found. Initiating keyless verification (relying on Sigstore Transparency Log Rekor)..."
      # Verifies keyless signature
      cosign verify \
        --certificate-identity-regexp "https://github.com/.*" \
        --certificate-oidc-issuer "https://token.actions.githubusercontent.com" \
        "${IMAGE_TAG}"
    fi
    echo "[Cosign] Image verification passed!"
    ;;

  *)
    usage
    ;;
esac
