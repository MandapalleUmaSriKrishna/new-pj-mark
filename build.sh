#!/usr/bin/env bash
# Builds the single-file offline game: index.html (all CSS + JS inlined, zero dependencies)
set -e
cd "$(dirname "$0")"
{
  echo '<!DOCTYPE html>'
  echo '<html lang="en">'
  echo '<head>'
  echo '<meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">'
  echo '<title>🧀 Cheese Chase! — Cat &amp; Mouse (offline game)</title>'
  echo '<style>'
  cat src/style.css
  echo '</style>'
  echo '</head>'
  echo '<body>'
  cat src/ui.html
  echo '<script>'
  cat src/00-core.js src/11-render3d.js src/12-world3d.js src/20-game2d.js src/30-main.js
  echo '</script>'
  echo '</body>'
  echo '</html>'
} > index.html
echo "Built index.html ($(wc -c < index.html) bytes)"
