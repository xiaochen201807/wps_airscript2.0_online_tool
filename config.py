"""
配置管理模块：统一安全加载本地 .env 环境变量
支持纯标准库轻量解析，避免强制安装第三方依赖。
"""

import os
from pathlib import Path
from typing import Optional


def load_dotenv(dotenv_path: Optional[str] = None):
    """
    轻量级加载 .env 文件中的键值对到 os.environ
    """
    if dotenv_path is None:
        dotenv_path = Path(__file__).resolve().parent / ".env"
    else:
        dotenv_path = Path(dotenv_path)

    if not dotenv_path.exists():
        return

    with open(dotenv_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            # 忽略空行和注释
            if not line or line.startswith("#") or "=" not in line:
                continue
            
            key, val = line.split("=", 1)
            key = key.strip()
            val = val.strip()
            # 去除两端引号
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            
            # 若系统环境变量未设置，则填充
            if key not in os.environ:
                os.environ[key] = val


# 模块加载时自动解析 .env
load_dotenv()


# ==================== 常用配置项获取接口 ====================

def get_wps_token(default: str = "your_token_here") -> str:
    """获取 WPS AirScript 统一 Token"""
    return os.getenv("WPS_TOKEN", default)


def get_balance_sheet_config():
    """获取资产负债表演示表格配置 (file_id, token, script_id)"""
    file_id = os.getenv("BALANCE_SHEET_FILE_ID", "your_balance_sheet_file_id")
    token = os.getenv("WPS_TOKEN", "your_token_here")
    script_id = os.getenv("BALANCE_SHEET_SCRIPT_ID", "your_balance_sheet_script_id")
    return file_id, token, script_id


def get_workhours_config():
    """获取周计划/工时表格配置 (file_id, token, script_id, default_person)"""
    file_id = os.getenv("WORKHOURS_FILE_ID", "your_workhours_file_id")
    token = os.getenv("WPS_TOKEN", "your_token_here")
    script_id = os.getenv("WORKHOURS_SCRIPT_ID", "your_workhours_script_id")
    default_person = os.getenv("DEFAULT_PERSON_NAME", "张三")
    return file_id, token, script_id, default_person
