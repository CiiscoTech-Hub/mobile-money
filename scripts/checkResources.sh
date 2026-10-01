#!/usr/bin/env bash
#
# scripts/checkResources.sh
# Monitors container CPU & Memory usage dynamically and triggers alert notifications
# when CPU usage exceeds 80% for longer than 2 minutes (120 seconds).
#

CPU_THRESHOLD=80
ALERT_DURATION_SECONDS=120
CHECK_INTERVAL_SECONDS=5

# State directory for tracking high CPU start timestamps per container
STATE_DIR="/tmp/container_cpu_alerts"
mkdir -p "${STATE_DIR}"

log_alert() {
  local container_id="$1"
  local container_name="$2"
  local cpu_val="$3"
  local duration="$4"
  local timestamp
  timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

  local alert_json
  alert_json=$(cat <<EOF
{
  "event": "CONTAINER_CPU_ALERT",
  "timestamp": "${timestamp}",
  "container_id": "${container_id}",
  "container_name": "${container_name}",
  "cpu_percentage": ${cpu_val},
  "sustained_duration_seconds": ${duration},
  "severity": "CRITICAL",
  "message": "Container ${container_name} (${container_id}) exceeded ${CPU_THRESHOLD}% CPU usage for ${duration}s"
}
EOF
  )

  echo "[ALERT] ${timestamp} - Container '${container_name}' (${container_id}) high CPU: ${cpu_val}% for ${duration}s"
  
  # Trigger alert via webhook if ALERT_WEBHOOK_URL environment variable is configured
  if [ -n "${ALERT_WEBHOOK_URL}" ]; then
    curl -s -X POST -H "Content-Type: application/json" -d "${alert_json}" "${ALERT_WEBHOOK_URL}" || true
  fi
}

check_container_resources() {
  # Get container stats: ID, Name, CPU %
  docker stats --no-stream --format "{{.ID}}\t{{.Name}}\t{{.CPUPerc}}" | while IFS=$'\t' read -r cid cname cpu; do
    # Strip % sign from CPU usage
    cpu_clean=$(echo "${cpu}" | sed 's/%//g' | cut -d'.' -f1)

    # Validate integer
    if ! [[ "${cpu_clean}" =~ ^[0-9]+$ ]]; then
      continue
    fi

    state_file="${STATE_DIR}/${cid}.ts"

    if [ "${cpu_clean}" -gt "${CPU_THRESHOLD}" ]; then
      current_time=$(date +%s)
      if [ -f "${state_file}" ]; then
        start_time=$(cat "${state_file}")
        elapsed=$((current_time - start_time))
        if [ "${elapsed}" -ge "${ALERT_DURATION_SECONDS}" ]; then
          log_alert "${cid}" "${cname}" "${cpu_clean}" "${elapsed}"
        fi
      else
        echo "${current_time}" > "${state_file}"
      fi
    else
      # CPU is normal, clear tracking
      rm -f "${state_file}"
    fi
  done
}

# Run single pass or continuous mode based on argument
if [ "$1" = "--once" ]; then
  check_container_resources
else
  echo "Starting container resource profiling alert daemon (Threshold: ${CPU_THRESHOLD}%, Alert after: ${ALERT_DURATION_SECONDS}s)..."
  while true; do
    check_container_resources
    sleep "${CHECK_INTERVAL_SECONDS}"
  done
fi
