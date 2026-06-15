#!/usr/bin/env python3
"""Validate and optionally merge locale JSON files against en.json.

Default: report missing/extra keys only — does NOT copy English into other locales.
Use --fill-english only for temporary dev scaffolding (not for release).
Use --regenerate-zh to rebuild zh.json from zh-Hant.json via OpenCC (Traditional → Simplified).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

LOCALES_DIR = Path(__file__).resolve().parents[1] / "src" / "i18n" / "locales"

ZH_OVERRIDES: dict[str, str] = {
    "軟體": "软件",
    "資訊": "信息",
    "網路": "网络",
    "登入": "登录",
    "程式": "程序",
    "檔案": "文件",
    "資料庫": "数据库",
    "伺服器": "服务器",
    "行動": "移动",
    "視窗": "窗口",
    "預設": "默认",
    "設定": "设置",
    "帳號": "账号",
    "聯絡": "联系",
    "電子郵件": "电子邮件",
    "匯出": "导出",
    "匯入": "导入",
    "載入": "加载",
    "儲存": "保存",
    "營運": "运营",
    "歸檔": "归档",
    "審核": "审核",
    "標記": "标记",
    "與": "与",
    "後": "后",
    "為": "为",
    "時": "时",
    "區間": "区间",
    "當下": "当下",
    "篩選": "筛选",
    "編輯": "编辑",
    "語言": "语言",
    "無法": "无法",
    "請": "请",
    "確認": "确认",
    "據": "据",
    "擊": "击",
    "選": "选",
    "擇": "择",
    "顯示": "显示",
    "開啟": "开启",
    "關閉": "关闭",
    "連結": "链接",
    "連線": "连线",
    "離線": "离线",
    "線上": "线上",
    "報表": "报表",
    "報告": "报告",
    "災害": "灾害",
    "損害": "损害",
    "建物": "建物",
    "圖": "图",
    "檢視": "检视",
    "儀表板": "仪表板",
    "專案": "项目",
    "組織": "组织",
    "單位": "单位",
    "權限": "权限",
    "範圍": "范围",
    "頂點": "顶点",
    "邊界": "边界",
    "凍結": "冻结",
    "分區": "分区",
    "危機": "危机",
    "狀態": "状态",
    "時間": "时间",
    "預覽": "预览",
    "執行": "执行",
    "批次": "批次",
    "自動": "自动",
    "手動": "手动",
    "官方": "官方",
    "自訂": "自定义",
    "查詢": "查询",
    "儲存報表": "保存报表",
    "儲存語言": "保存语言",
}


def load(path: Path) -> dict[str, str]:
    with path.open(encoding="utf-8") as f:
        return json.load(f)


def save(path: Path, data: dict[str, str]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")


def to_simplified(text: str, converter) -> str:
    if not text:
        return text
    out = converter.convert(text)
    for src, dst in ZH_OVERRIDES.items():
        out = out.replace(src, dst)
    return out


def regenerate_zh(en: dict[str, str], zh_hant: dict[str, str]) -> dict[str, str]:
    try:
        import opencc
    except ImportError as exc:
        raise SystemExit("opencc-python-reimplemented required: python -m pip install opencc-python-reimplemented") from exc
    converter = opencc.OpenCC("t2s")
    zh: dict[str, str] = {}
    for key in sorted(en.keys()):
        zh[key] = to_simplified(zh_hant.get(key, en[key]), converter)
    return zh


def merge_locale(
    name: str,
    en: dict[str, str],
    existing: dict[str, str],
    *,
    fill_english: bool,
) -> tuple[dict[str, str], list[str]]:
    merged: dict[str, str] = {}
    missing: list[str] = []
    for key in sorted(en.keys()):
        if key in existing:
            merged[key] = existing[key]
        elif fill_english:
            merged[key] = en[key]
            missing.append(key)
        else:
            missing.append(key)
    return merged, missing


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate or merge i18n locale files.")
    parser.add_argument(
        "--fill-english",
        action="store_true",
        help="Add missing keys using English (dev only — do not use for release).",
    )
    parser.add_argument(
        "--regenerate-zh",
        action="store_true",
        help="Rebuild zh.json from zh-Hant.json using OpenCC t2s.",
    )
    parser.add_argument("--write", action="store_true", help="Write merged output (requires --fill-english or --regenerate-zh).")
    args = parser.parse_args()

    en = load(LOCALES_DIR / "en.json")
    zh_hant = load(LOCALES_DIR / "zh-Hant.json")
    exit_code = 0

    if args.regenerate_zh:
        zh = regenerate_zh(en, zh_hant)
        save(LOCALES_DIR / "zh.json", zh)
        print(f"zh.json: regenerated {len(zh)} keys from zh-Hant (OpenCC t2s)")
        if not args.write:
            args.write = True

    for path in sorted(LOCALES_DIR.glob("*.json")):
        if path.name == "en.json":
            continue
        if path.name == "zh.json" and args.regenerate_zh:
            continue
        existing = load(path)
        extra = sorted(set(existing) - set(en))
        merged, missing = merge_locale(path.name, en, existing, fill_english=args.fill_english)
        if extra:
            print(f"{path.name}: WARNING {len(extra)} extra keys")
            exit_code = 1
        if missing:
            print(f"{path.name}: missing {len(missing)} keys")
            if args.fill_english and args.write:
                save(path, merged)
                print(f"  -> filled with English")
            else:
                exit_code = 1
        else:
            print(f"{path.name}: OK ({len(existing)} keys)")

    if exit_code and not args.fill_english:
        print("\nTip: translate missing keys properly; do not copy English into locale files.")
        print("     zh: python scripts/sync-i18n.py --regenerate-zh")
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
