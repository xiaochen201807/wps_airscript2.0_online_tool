"""
WPS 智能表格 - 周计划/每日工时只读智能查询工具
【安全保证】：严禁任何修改、写入、删除操作，纯读取已有数据

功能特性：
1. 自动识别最新周计划 Sheet 及历史周（兼容表名尾部空格，支持未来每周新增的周计划 sheet）；
2. 动态扫描表头结构（任务类型、需求/缺陷ID、任务内容、负责人、周一~周日工时、总工时等）；
3. 精准聚合指定人员（默认：刘晓晨）每日工时分布与任务明细；
4. 若指定周/当前周暂无该人员数据，自动提示并回溯展示最近一期有记录的周计划工时。
"""

import sys
import re
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple
from wps_airscript_client import WPSAirScriptClient
from config import get_workhours_config

# 从环境变量/.env中读取配置
FILE_ID, TOKEN, SCRIPT_ID, TARGET_PERSON_DEFAULT, BASE_URL = get_workhours_config()


def get_all_week_sheets(sheets: List[str]) -> List[str]:
    """提取并按时间倒序排列所有周计划工作表"""
    week_pattern = re.compile(r'(\d+)[.\-月](\d+)\s*[-~至到]\s*(\d+)[.\-月]?(\d+)?')
    matched_sheets = []
    
    for s in sheets:
        clean_s = s.strip()
        m = week_pattern.search(clean_s)
        if m:
            try:
                m1 = int(m.group(1))
                d1 = int(m.group(2))
                matched_sheets.append((m1 * 100 + d1, s))
            except Exception:
                matched_sheets.append((0, s))

    # 按月份和日期从大到小排序（最新的周排在最前）
    matched_sheets.sort(key=lambda x: x[0], reverse=True)
    return [s[1] for s in matched_sheets]


def query_person_workhours_in_sheet(client: WPSAirScriptClient, sheet_name: str, person_name: str) -> Optional[Dict[str, Any]]:
    """在指定工作表中查询人员的工时与明细"""
    # 周计划表可能包含多达500+行数据，扫描 A1:U800 完整区域
    raw_res = client.get_range_values("A1:U800", sheet_name=sheet_name)
    if not raw_res or not isinstance(raw_res, list) or not isinstance(raw_res[0], dict) or "values" not in raw_res[0]:
        return None

    matrix = raw_res[0]["values"]
    if not matrix or len(matrix) < 2:
        return None

    # 智能定位表头行
    header_row_idx = -1
    header = []
    col_map = {}

    for idx, row in enumerate(matrix[:5]):
        row_str = [str(c).strip() if c is not None else "" for c in row]
        if "负责人" in row_str and any("工时" in c for c in row_str):
            header_row_idx = idx
            header = row_str
            break

    if header_row_idx == -1:
        return None

    for col_idx, col_name in enumerate(header):
        if not col_name:
            continue
        if "负责人" in col_name:
            col_map["person"] = col_idx
        elif "总工时" in col_name:
            col_map["total"] = col_idx
        elif "周一" in col_name:
            col_map["mon"] = col_idx
        elif "周二" in col_name:
            col_map["tue"] = col_idx
        elif "周三" in col_name:
            col_map["wed"] = col_idx
        elif "周四" in col_name:
            col_map["thu"] = col_idx
        elif "周五" in col_name:
            col_map["fri"] = col_idx
        elif "周六" in col_name:
            col_map["sat"] = col_idx
        elif "周日" in col_name:
            col_map["sun"] = col_idx
        elif "任务内容" in col_name:
            col_map["task_desc"] = col_idx
        elif "任务类型" in col_name:
            col_map["task_type"] = col_idx
        elif "需求/缺陷ID" in col_name or "ID" in col_name:
            col_map["req_id"] = col_idx
        elif "是否完成" in col_name:
            col_map["status"] = col_idx

    if "person" not in col_map:
        return None

    days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    day_names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

    def parse_hours(val):
        if val is None or str(val).strip() == "":
            return 0.0
        try:
            return float(val)
        except ValueError:
            return 0.0

    person_tasks = []
    daily_sum = {d: 0.0 for d in days}
    total_hours_sum = 0.0

    for row_idx, row in enumerate(matrix[header_row_idx + 1:], start=header_row_idx + 2):
        person_val = str(row[col_map["person"]]).strip() if col_map["person"] < len(row) and row[col_map["person"]] is not None else ""
        if person_name not in person_val:
            continue

        task_desc = str(row[col_map["task_desc"]]).strip() if "task_desc" in col_map and col_map["task_desc"] < len(row) and row[col_map["task_desc"]] is not None else ""
        task_type = str(row[col_map["task_type"]]).strip() if "task_type" in col_map and col_map["task_type"] < len(row) and row[col_map["task_type"]] is not None else ""
        req_id = str(row[col_map["req_id"]]).strip() if "req_id" in col_map and col_map["req_id"] < len(row) and row[col_map["req_id"]] is not None else ""
        task_status = str(row[col_map["status"]]).strip() if "status" in col_map and col_map["status"] < len(row) and row[col_map["status"]] is not None else ""
        total_h = parse_hours(row[col_map["total"]]) if "total" in col_map and col_map["total"] < len(row) else 0.0

        daily_vals = {}
        for d in days:
            if d in col_map and col_map[d] < len(row):
                h = parse_hours(row[col_map[d]])
                daily_vals[d] = h
                daily_sum[d] += h
            else:
                daily_vals[d] = 0.0

        total_hours_sum += total_h

        person_tasks.append({
            "row": row_idx,
            "task_desc": task_desc,
            "task_type": task_type,
            "req_id": req_id,
            "status": task_status,
            "total_h": total_h,
            "daily_vals": daily_vals
        })

    return {
        "sheet_name": sheet_name,
        "person_tasks": person_tasks,
        "daily_sum": daily_sum,
        "total_hours_sum": total_hours_sum,
        "days": days,
        "day_names": day_names
    }


def print_result_report(result: Dict[str, Any], person_name: str):
    """格式化打印工时报表"""
    sheet_name = result["sheet_name"]
    person_tasks = result["person_tasks"]
    daily_sum = result["daily_sum"]
    total_hours_sum = result["total_hours_sum"]
    days = result["days"]
    day_names = result["day_names"]

    print("=" * 75)
    print(f"📊 【工作表: {sheet_name.strip()}】 负责人【{person_name}】工时统计报表")
    print("=" * 75)

    print(f"\n🗓️ 一、每日工时汇总统计（本周累计总工时：{total_hours_sum:.1f} 小时）:")
    print("-" * 75)
    for d, d_name in zip(days, day_names):
        h = daily_sum[d]
        bar = "█" * int(h * 2) if h > 0 else "—"
        print(f"  📅 {d_name}: {h:5.1f} 小时  {bar}")
    print("-" * 75)
    print(f"  ⭐️ 本周总工时合计: {total_hours_sum:5.1f} 小时\n")

    print(f"📝 二、具体任务明细清单（共 {len(person_tasks)} 项任务）:")
    print("-" * 75)
    for idx, t in enumerate(person_tasks, start=1):
        req_tag = f" [需求/缺陷ID: {t['req_id']}]" if t['req_id'] and t['req_id'] != "——" else ""
        type_tag = f"[{t['task_type']}]" if t['task_type'] else "[任务]"
        status_tag = f" [状态: {t['status']}]" if t['status'] else ""
        print(f"{idx:2d}. 【行 {t['row']:2d}】 {type_tag}{req_tag} {t['task_desc']}{status_tag}")
        
        # 每日工时分布
        daily_detail_list = [f"{d_name}: {t['daily_vals'][d]:.1f}h" for d, d_name in zip(days, day_names) if t['daily_vals'][d] > 0]
        daily_detail_str = " | ".join(daily_detail_list) if daily_detail_list else "未单独拆分单日"
        print(f"    └─ 任务总工时: {t['total_h']:.1f}h ── 每日投入: {daily_detail_str}")
        print()


def main():
    person_name = sys.argv[1] if len(sys.argv) > 1 else TARGET_PERSON_DEFAULT
    specified_sheet = sys.argv[2] if len(sys.argv) > 2 else None

    print("🔒 启动纯只读查询工具，正在连接 WPS 智能表格...")
    client = WPSAirScriptClient(FILE_ID, TOKEN, SCRIPT_ID, base_url=BASE_URL)

    all_sheets = client.get_workbook_sheets()
    week_sheets = get_all_week_sheets(all_sheets)

    if specified_sheet:
        target_sheets = [s for s in all_sheets if specified_sheet.strip() in s]
        if not target_sheets:
            print(f"❌ 未找到指定的工作表: {specified_sheet}")
            return
    else:
        target_sheets = week_sheets

    # 优先查指定的第一张表（例如当前周 8.17-8.23）
    found_any = False
    for sheet in target_sheets:
        res = query_person_workhours_in_sheet(client, sheet, person_name)
        if res and res["person_tasks"]:
            print_result_report(res, person_name)
            found_any = True
            if specified_sheet:
                break
            # 如果是自动扫描，展示最近有数据的周计划即可
            break
        elif sheet.strip() == "8.17-8.23":
            print(f"ℹ️ 检索当前周 【{sheet.strip()}】: 暂未登记 [{person_name}] 的任务行，正在自动检索最近一期记录...")

    if not found_any:
        print(f"\n⚠️ 在已检索的周计划工作表中均未找到 [{person_name}] 的工时记录。")


if __name__ == "__main__":
    main()
