#!/usr/bin/env bash
# ==============================================================================
# CLIProxyAPI Plus - 全平台多架构交叉编译与自动化打包脚本 (Linux / macOS / Git Bash)
# 支持的目标操作系统与架构：
#   - Windows (amd64, arm64) -> .zip 归档
#   - Linux   (amd64, arm64) -> .tar.gz 归档
#   - macOS   (amd64, arm64) -> .tar.gz 归档
# ==============================================================================

set -euo pipefail

# 切换到项目根目录
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

DIST_DIR="${ROOT_DIR}/dist"
TMP_BUILD_DIR="${DIST_DIR}/.tmp"

# 提取版本元数据（优先读取环境变量，其次尝试 git，最后使用默认值）
VERSION="${VERSION:-$(git describe --tags --always 2>/dev/null || echo "v8.0.47-plus")}"
VERSION="${VERSION#v}" # 去除前导 v
COMMIT="${COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo "release")}"
BUILD_DATE="${BUILD_DATE:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

echo "=========================================================="
echo " CLIProxyAPI Plus 全平台构建打包"
echo " 版本: ${VERSION} | Commit: ${COMMIT} | 时间: ${BUILD_DATE}"
echo "=========================================================="

# 1. 检查基础构建环境
command -v go >/dev/null 2>&1 || { echo "[错误] 未检测到 Go 环境，请先安装 Go 1.22+"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "[错误] 未检测到 Node.js 环境，请先安装 Node.js 18+"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "[错误] 未检测到 npm 环境"; exit 1; }

# 2. 构建前端单页应用并注入 static 目录
echo ""
echo "[步骤 1/4] 构建前端 Web 管理面板 (web/ -> internal/webui/static)..."
(
  cd "${ROOT_DIR}/web"
  if [ ! -d "node_modules" ]; then
    echo "正在安装前端依赖 (npm install)..."
    npm install
  fi
  npm run build
)

# 确保前端构建产物存在
if [ ! -f "${ROOT_DIR}/internal/webui/static/index.html" ]; then
  echo "[错误] 前端构建产物 internal/webui/static/index.html 不存在，构建失败！"
  exit 1
fi
echo "[完成] 前端资源已成功嵌入 internal/webui/static/"

# 3. 准备输出目录
echo ""
echo "[步骤 2/4] 初始化输出目录: ${DIST_DIR}..."
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}" "${TMP_BUILD_DIR}"

LDFLAGS="-s -w -X main.Version=${VERSION} -X main.Commit=${COMMIT} -X main.BuildDate=${BUILD_DATE}"

# 定义构建矩阵: "操作系统 架构 二进制名称 归档格式 归档架构标识"
PLATFORMS=(
  "windows amd64 cliproxyapi-plus.exe zip windows_amd64"
  "windows arm64 cliproxyapi-plus.exe zip windows_arm64"
  "linux   amd64 cliproxyapi-plus     tar.gz linux_amd64"
  "linux   arm64 cliproxyapi-plus     tar.gz linux_arm64"
  "darwin  amd64 cliproxyapi-plus     tar.gz darwin_amd64"
  "darwin  arm64 cliproxyapi-plus     tar.gz darwin_arm64"
)

# 4. 矩阵交叉编译与打包
echo ""
echo "[步骤 3/4] 开始跨平台编译与打包..."

for row in "${PLATFORMS[@]}"; do
  read -r os arch bin_name format asset_tag <<< "${row}"
  echo ""
  echo ">>> 正在构建: OS=${os} ARCH=${arch} (${asset_tag})..."

  pkg_dir="${TMP_BUILD_DIR}/${asset_tag}"
  rm -rf "${pkg_dir}"
  mkdir -p "${pkg_dir}"

  # 纯 Go 交叉编译（嵌入前端 staticFS）
  CGO_ENABLED=0 GOOS="${os}" GOARCH="${arch}" go build -buildvcs=false \
    -ldflags="${LDFLAGS}" \
    -o "${pkg_dir}/${bin_name}" \
    ./cmd/server

  # 复制随附配置文件与说明
  [ -f "${ROOT_DIR}/config.example.yaml" ] && cp "${ROOT_DIR}/config.example.yaml" "${pkg_dir}/"
  [ -f "${ROOT_DIR}/LICENSE" ] && cp "${ROOT_DIR}/LICENSE" "${pkg_dir}/"
  [ -f "${ROOT_DIR}/README.md" ] && cp "${ROOT_DIR}/README.md" "${pkg_dir}/"

  archive_name="CLIProxyAPI_Plus_${VERSION}_${asset_tag}.${format}"
  dest_archive="${DIST_DIR}/${archive_name}"

  # 压缩打包
  if [ "${format}" = "zip" ]; then
    if command -v zip >/dev/null 2>&1; then
      (cd "${pkg_dir}" && zip -q -9 -r "${dest_archive}" .)
    else
      # Windows Git Bash 下若无 zip 命令，尝试调用 powershell Compress-Archive 或 tar
      (cd "${pkg_dir}" && tar -acf "${dest_archive}" *)
    fi
  else
    tar -czf "${dest_archive}" -C "${pkg_dir}" .
  fi

  echo "    已生成发布包: ${archive_name} ($(du -h "${dest_archive}" | awk '{print $1}'))"
done

# 清理临时工作目录
rm -rf "${TMP_BUILD_DIR}"

# 5. 生成 SHA-256 校验文件
echo ""
echo "[步骤 4/4] 计算 SHA-256 校验和..."
(
  cd "${DIST_DIR}"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum CLIProxyAPI_Plus_* > checksums.txt
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 CLIProxyAPI_Plus_* > checksums.txt
  fi
)

echo ""
echo "=========================================================="
echo " 全部打包完成！产物存放于: ${DIST_DIR}"
echo "=========================================================="
ls -lh "${DIST_DIR}"
