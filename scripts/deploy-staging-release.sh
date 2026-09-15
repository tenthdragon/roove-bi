#!/usr/bin/env bash
set -Eeuo pipefail

umask 027

release_id="${1:-}"
archive_path="${2:-}"
release_root="/var/www/releases/roove-bi-staging"
release_dir="${release_root}/${release_id}"
current_link="${release_root}/current"
shared_env="/var/www/roove-bi/.env.local"

if [[ ! "${release_id}" =~ ^[0-9a-f]{8}-[0-9]+$ ]]; then
  echo "Invalid release id."
  exit 2
fi

expected_archive="${release_root}/incoming-${release_id}.tar.gz"
if [[ "${archive_path}" != "${expected_archive}" || ! -f "${archive_path}" ]]; then
  echo "Release archive is missing or outside the staging release directory."
  exit 2
fi

if [[ ! -r "${shared_env}" ]]; then
  echo "Shared staging environment file is not readable."
  exit 2
fi

if [[ -e "${release_dir}" ]]; then
  echo "Release already exists: ${release_id}"
  exit 2
fi

previous_release="$(readlink -f "${current_link}" 2>/dev/null || true)"
next_link="${release_root}/.current-${release_id}"
deployment_complete=false

cleanup() {
  rm -f "${archive_path}" "${next_link}"
  if [[ "${deployment_complete}" != "true" && -d "${release_dir}" ]]; then
    rm -rf "${release_dir}"
  fi
}
trap cleanup EXIT

mkdir -p "${release_dir}"
tar -xzf "${archive_path}" -C "${release_dir}"
ln -s "${shared_env}" "${release_dir}/.env.local"

cd "${release_dir}"
npm ci --no-audit --no-fund
NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=2560 npm run build

chgrp -R roove "${release_dir}"
chmod -R g+rX "${release_dir}"

ln -s "${release_dir}" "${next_link}"
mv -Tf "${next_link}" "${current_link}"
sudo /usr/bin/systemctl restart roove-bi-staging.service

healthy=false
for _attempt in {1..30}; do
  if curl --fail --silent --show-error --max-time 3 http://127.0.0.1:3001/ >/dev/null; then
    healthy=true
    break
  fi
  sleep 1
done

if [[ "${healthy}" != "true" ]]; then
  if [[ -n "${previous_release}" && -d "${previous_release}" ]]; then
    rollback_link="${release_root}/.rollback-${release_id}"
    ln -s "${previous_release}" "${rollback_link}"
    mv -Tf "${rollback_link}" "${current_link}"
    sudo /usr/bin/systemctl restart roove-bi-staging.service
  fi
  echo "Staging health check failed; previous release restored."
  exit 1
fi

deployment_complete=true
echo "Staging deployed: ${release_id}"
