#!/usr/bin/env bash
# Run the host-side tunnel-client against Docker's loopback-published MCP port.
set +x
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
env_file="${1:-${script_dir}/.env}"
if [[ ! -r "${env_file}" ]]; then
  echo "Missing readable environment file: ${env_file}" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "${env_file}"
set +a

: "${CONTROL_PLANE_API_KEY:?Set CONTROL_PLANE_API_KEY in the environment file}"
: "${OPENAI_TUNNEL_ID:?Set OPENAI_TUNNEL_ID in the environment file}"
mcp_token="${PKM_MCP_TOKEN:-${MCP_BEARER_TOKEN:-}}"
if [[ ${#mcp_token} -lt 32 || "${mcp_token}" =~ [[:space:]] ]]; then
  echo "Set PKM_MCP_TOKEN (or MCP_BEARER_TOKEN) to at least 32 characters without whitespace" >&2
  exit 1
fi
if [[ "${PKM_MCP_AUTH:-token}" != "token" ]]; then
  echo "This launcher requires PKM_MCP_AUTH=token" >&2
  exit 1
fi

tunnel_client="${TUNNEL_CLIENT_BIN:-$(command -v tunnel-client || true)}"
if [[ -z "${tunnel_client}" ]]; then
  tunnel_client="${HOME}/.local/bin/tunnel-client"
fi
if [[ ! -x "${tunnel_client}" ]]; then
  echo "Install tunnel-client or set TUNNEL_CLIENT_BIN to its executable path" >&2
  exit 1
fi

mcp_port="${PKM_MCP_HTTP_PORT:-3211}"
health_port="${OPENAI_TUNNEL_HEALTH_PORT:-18080}"
for port in "${mcp_port}" "${health_port}"; do
  if [[ ! "${port}" =~ ^[0-9]{1,5}$ ]] || (( 10#${port} < 1 || 10#${port} > 65535 )); then
    echo "PKM_MCP_HTTP_PORT and OPENAI_TUNNEL_HEALTH_PORT must be integers from 1 to 65535" >&2
    exit 1
  fi
done
mcp_port="$((10#${mcp_port}))"
health_port="$((10#${health_port}))"

exec "${tunnel_client}" run \
  --control-plane.api-key env:CONTROL_PLANE_API_KEY \
  --control-plane.tunnel-id "${OPENAI_TUNNEL_ID}" \
  --mcp.server-url "url=http://127.0.0.1:${mcp_port}/mcp" \
  --mcp.extra-headers "Authorization: Bearer ${mcp_token}" \
  --mcp.discovery-extra-headers "Authorization: Bearer ${mcp_token}" \
  --health.listen-addr "127.0.0.1:${health_port}" \
  --log.level info
