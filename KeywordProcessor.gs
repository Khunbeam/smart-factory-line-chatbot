// ==========================================
// KeywordProcessor.gs — ระบบตอบกลับแบบคีย์เวิร์ด (Fallback)
// ==========================================
// 📌 ไฟล์นี้ทำงานเป็น Fallback เมื่อ AI ไม่สามารถตอบได้
//    ตรวจจับคีย์เวิร์ดจากข้อความผู้ใช้แล้วดึงข้อมูลตอบกลับ
//
//    รองรับคำสั่งหลัก:
//    - "loss เดือน/อาทิตย์"    → สรุป Loss ตามช่วงเวลา
//    - "สวัสดี/hi/มีอะไรบ้าง" → ข้อความต้อนรับ
//    - "วันนี้"               → รายงานปัญหากะ Day วันนี้
//    - "เมื่อคืน"             → รายงานปัญหากะ Night เมื่อคืน
//    - "ล่าสุด"               → 5 รายการปัญหาล่าสุด
//    - "สรุปวันที่/วันที่"     → รายงานปัญหาวันที่ระบุ
//    - "line N"               → ประวัติปัญหาของ Line ที่ระบุ
// ==========================================

/**
 * processKeyword — ตรวจจับคีย์เวิร์ดและสร้างข้อความตอบกลับ
 *
 * @param {string} message — ข้อความจากผู้ใช้
 * @param {Object} sheetData — ข้อมูลจาก getSheetDataFull() → { rows: string[][] }
 * @return {string} — ข้อความตอบกลับ
 */
function processKeyword(message, sheetData) {
  const rows = sheetData.rows;
  if (rows.length === 0) return "ไม่พบข้อมูลใน Sheet ครับ";
  const lowerMsg = message.toLowerCase().trim();

  // === Helper Functions (ใช้ภายในฟังก์ชันนี้เท่านั้น) ===

  /**
   * parseDateObj — แปลงสตริงวันที่เป็น Date object
   * รองรับรูปแบบ: YYYY-MM-DD, DD/MM/YYYY, MM/DD/YYYY
   */
  function parseDateObj(dateStr) {
    if (!dateStr) return null;
    let str = dateStr.toString().trim().split(" ")[0];
    let parts = str.split(/[-/]/);
    if (parts.length < 3) return null;
    let y, m, d;
    if (parts[0].length === 4) {
      y = parseInt(parts[0], 10); m = parseInt(parts[1], 10) - 1; d = parseInt(parts[2], 10);
    } else {
      y = parseInt(parts[2], 10); if (y < 100) y += 2000;
      let p1 = parseInt(parts[0], 10); let p2 = parseInt(parts[1], 10);
      if (p1 > 12) { d = p1; m = p2 - 1; } else { m = p1 - 1; d = p2; }
    }
    return new Date(y, m, d);
  }

  /**
   * getPossibleDateStrings — สร้างรูปแบบวันที่ที่เป็นไปได้ทั้งหมด
   * ใช้สำหรับจับคู่กับวันที่ในชีทที่อาจมีหลายฟอร์แมต
   */
  function getPossibleDateStrings(inputStr) {
    let nums = inputStr.match(/\d+/g);
    if (!nums || nums.length < 3) return [inputStr];
    let n1 = parseInt(nums[0], 10), n2 = parseInt(nums[1], 10), n3 = parseInt(nums[2], 10);
    let y, a, b;
    if (n1 > 1000) { y = n1; a = n2; b = n3; } else { y = n3 < 100 ? n3 + 2000 : n3; a = n1; b = n2; }
    let pad = (n) => ("0" + n).slice(-2); let unpad = (n) => parseInt(n, 10).toString();
    let patterns = [inputStr]; let pairs = [[a, b], [b, a]];
    pairs.forEach(pair => {
      let m = pair[0], d = pair[1]; if (m > 12) return;
      patterns.push(`${y}-${pad(m)}-${pad(d)}`, `${y}/${pad(m)}/${pad(d)}`, `${unpad(d)}/${unpad(m)}/${y}`, `${pad(d)}/${pad(m)}/${y}`, `${unpad(m)}/${unpad(d)}/${y}`, `${pad(m)}/${pad(d)}/${y}`, `${unpad(d)}-${unpad(m)}-${y}`, `${pad(d)}-${pad(m)}-${y}`);
    });
    return patterns;
  }

  /**
   * isDateMatch — ตรวจสอบว่าวันที่ในชีทตรงกับวันที่เป้าหมายหรือไม่
   */
  function isDateMatch(sheetDate, targetPatterns) {
    if (!sheetDate) return false;
    let sDate = sheetDate.toString().trim();
    for (let i = 0; i < targetPatterns.length; i++) {
      let p = targetPatterns[i];
      if (sDate === p || sDate.startsWith(p + " ") || sDate.startsWith(p + "T")) return true;
    }
    return false;
  }

  // ==========================================
  // คำสั่ง: "loss เดือน" หรือ "loss อาทิตย์/สัปดาห์"
  // ==========================================
  if (lowerMsg.includes("loss") && (lowerMsg.includes("เดือน") || lowerMsg.includes("อาทิตย์") || lowerMsg.includes("สัปดาห์"))) {
    let isMonthly = lowerMsg.includes("เดือน");
    let isWeekly = lowerMsg.includes("อาทิตย์") || lowerMsg.includes("สัปดาห์");

    let now = new Date();
    let totalCount = 0, totalFixTime = 0;
    let deptCount = {};
    let startOfWeek, endOfWeek;

    if (isWeekly) {
      let dayOfWeek = now.getDay();
      let diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
      startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday, 0, 0, 0);
      endOfWeek = new Date(startOfWeek.getFullYear(), startOfWeek.getMonth(), startOfWeek.getDate() + 6, 23, 59, 59);
    }

    for (let i = 0; i < rows.length; i++) {
      let dObj = parseDateObj(rows[i][1]);
      if (!dObj) continue;

      let isMatch = false;
      if (isMonthly) {
        if (dObj.getFullYear() === now.getFullYear() && dObj.getMonth() === now.getMonth()) isMatch = true;
      } else if (isWeekly) {
        if (dObj >= startOfWeek && dObj <= endOfWeek) isMatch = true;
      }

      if (isMatch) {
        let deptLoss = rows[i][10] ? rows[i][10].toString().trim() : "";
        if (deptLoss !== "" && deptLoss !== "-") {
          totalCount++;
          let fixTime = parseInt(rows[i][12], 10);
          if (!isNaN(fixTime)) totalFixTime += fixTime;
          deptCount[deptLoss] = (deptCount[deptLoss] || 0) + 1;
        }
      }
    }

    let titleStr = isMonthly ? `ประจำเดือนนี้ (${now.getMonth() + 1}/${now.getFullYear()})` : `ประจำอาทิตย์นี้`;
    if (totalCount === 0) return `✅ ไม่พบการเกิด Loss ${titleStr} ครับ`;

    let text = `📊 สรุปรายงาน Loss ${titleStr}\n\n🚨 เกิด Loss ทั้งหมด: ${totalCount} ครั้ง\n⏱️ รวมเวลาแก้ไขทั้งหมด: ${totalFixTime} นาที\n\n🏢 แยกจำนวนตามแผนก:\n`;
    for (let dept in deptCount) {
      text += `• ${dept}: ${deptCount[dept]} ครั้ง\n`;
    }
    return text.trim();
  }

  // ==========================================
  // คำสั่ง: ทักทาย (สวัสดี, hi, มีอะไรบ้าง)
  // ==========================================
  else if (lowerMsg.includes("สวัสดี") || lowerMsg.includes("หวัดดี") || lowerMsg.includes("hi") || lowerMsg.includes("ไง") || lowerMsg.includes("มีอะไรบ้าง") || lowerMsg.includes("อะไรบ้าง")) {
    return "ต้องการสอบถามข้อมูลด้านไหนดีครับ เช่น loss แผนก , เหตุการณ์ต่างๆ สอบถามได้เลยครับ";
  }

  // ==========================================
  // คำสั่ง: "วันนี้" — รายงานปัญหากะ Day ของวันนี้
  // ==========================================
  else if (lowerMsg === "วันนี้มีอะไรไหม" || lowerMsg === "วันนี้") {
    let now = new Date();
    let year = now.getFullYear(); let month = ("0" + (now.getMonth() + 1)).slice(-2); let day = ("0" + now.getDate()).slice(-2);
    let searchPatterns = getPossibleDateStrings(`${year}-${month}-${day}`);

    let text = `📋 สรุปรายงานปัญหา "วันนี้" ☀️\n`;
    let count = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      let shift = rows[i][4] ? rows[i][4].toString().trim().toLowerCase() : "";
      if (isDateMatch(rows[i][1], searchPatterns) && shift === "day") {
        let line = rows[i][5], job = rows[i][6] || "-", dept = rows[i][10], prob = rows[i][14] || "-";
        text += `🏭 [Line ${line}] Job ${job} แผนก: ${dept}\n⚠️ ปัญหา: ${prob}\n━━━━━━━━━━━━━\n\n`;
        count++;
      }
    }
    if (count === 0) return `✅ วันนี้ยังไม่มีรายงานปัญหาในกะ Day ครับ`;
    return text.trim();
  }

  // ==========================================
  // คำสั่ง: "เมื่อคืน" — รายงานปัญหากะ Night เมื่อวาน
  // ==========================================
  else if (lowerMsg === "เมื่อคืน") {
    let targetDateObj = new Date();
    targetDateObj.setDate(targetDateObj.getDate() - 1);
    let year = targetDateObj.getFullYear(); let month = ("0" + (targetDateObj.getMonth() + 1)).slice(-2); let day = ("0" + targetDateObj.getDate()).slice(-2);
    let displayDateStr = `${day}-${month}-${year}`;
    let searchPatterns = getPossibleDateStrings(`${year}-${month}-${day}`);

    let text = `📋 สรุปรายงานปัญหา "เมื่อคืน" 🌙\nประจำวันที่: ${displayDateStr}\n\n`;
    let count = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      let shift = rows[i][4] ? rows[i][4].toString().trim().toLowerCase() : "";
      if (isDateMatch(rows[i][1], searchPatterns) && shift === "night") {
        let line = rows[i][5], job = rows[i][6] || "-", dept = rows[i][10];
        let startTime = rows[i][11] || "-", fixTime = rows[i][12] || "-", secFixed = rows[i][13] || "-";
        let prob = rows[i][14] || "ไม่ได้ระบุ", detail = rows[i][15] || "ไม่มีรายละเอียด";

        text += `🏭 [Line ${line}] Job ${job} แผนก: ${dept}\n⏰ เวลาเริ่มปัญหา: ${startTime}\n⏱️ ระยะเวลาแก้ไข: ${fixTime} นาที\n🔧 Section ที่แก้ไข: ${secFixed}\n⚠️ ปัญหาที่เกิด: ${prob}\n📝 รายละเอียด: ${detail}\n━━━━━━━━━━━━━\n\n`;
        count++;
      }
    }
    if (count === 0) return `✅ ไม่พบรายงานปัญหาของกะ Night ในวันที่ ${displayDateStr} ครับ`;
    return text.trim();
  }

  // ==========================================
  // คำสั่ง: "ล่าสุด" — 5 รายการปัญหาล่าสุด
  // ==========================================
  else if (lowerMsg === "ล่าสุด") {
    let text = `📋 รายงานปัญหาล่าสุด:\n\n`;
    let count = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      let date = rows[i][1] ? rows[i][1].split(" ")[0] : "-";
      let shift = rows[i][4] ? rows[i][4].toString().trim() : "-";
      let line = rows[i][5], job = rows[i][6] || "-", dept = rows[i][10];
      let startTime = rows[i][11] || "-", fixTime = rows[i][12] || "-", secFixed = rows[i][13] || "-";
      let prob = rows[i][14] || "ไม่ได้ระบุ", detail = rows[i][15] || "ไม่มีรายละเอียด";

      text += `🏭 [Line ${line}] Job ${job} แผนก: ${dept}\n📅 วันที่: ${date} (กะ: ${shift})\n⏰ เวลาเริ่มปัญหา: ${startTime}\n⏱️ ระยะเวลาแก้ไข: ${fixTime} นาที\n🔧 Section ที่แก้ไข: ${secFixed}\n⚠️ ปัญหาที่เกิด: ${prob}\n📝 รายละเอียด: ${detail}\n━━━━━━━━━━━━━\n\n`;
      count++;
      if (count >= 5) break;
    }
    if (count === 0) return `✅ ไม่พบรายงานปัญหาครับ`;
    return text.trim();
  }

  // ==========================================
  // คำสั่ง: "สรุปวันที่ DD/MM/YYYY" หรือ "วันที่ DD/MM/YYYY"
  // ==========================================
  else if (lowerMsg.startsWith("สรุปวันที่") || lowerMsg.startsWith("วันที่")) {
    let dateMatch = message.match(/\d+[\/-]\d+[\/-]\d+/);
    if (dateMatch) {
      let inputDate = dateMatch[0];
      let searchPatterns = getPossibleDateStrings(inputDate);
      let text = `📋 สรุปรายงานปัญหา "ทั้งวัน"\nประจำวันที่: ${inputDate}\n\n`;
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (isDateMatch(rows[i][1], searchPatterns)) {
          let shift = rows[i][4] ? rows[i][4].toString().trim() : "-";
          let line = rows[i][5], job = rows[i][6] || "-", dept = rows[i][10];
          let startTime = rows[i][11] || "-", fixTime = rows[i][12] || "-", secFixed = rows[i][13] || "-";
          let prob = rows[i][14] || "ไม่ได้ระบุ", detail = rows[i][15] || "ไม่มีรายละเอียด";

          text += `🏭 [Line ${line}] Job ${job} แผนก: ${dept}\n🌓 กะทำงาน: ${shift}\n⏰ เวลาเริ่มปัญหา: ${startTime}\n⏱️ ระยะเวลาแก้ไข: ${fixTime} นาที\n🔧 Section ที่แก้ไข: ${secFixed}\n⚠️ ปัญหาที่เกิด: ${prob}\n📝 รายละเอียด: ${detail}\n━━━━━━━━━━━━━\n\n`;
          count++;
        }
      }
      if (count > 0) return text.trim();
    }
  }

  // ==========================================
  // คำสั่ง: "line N" — ประวัติปัญหาล่าสุดของ Line ที่ระบุ
  // ==========================================
  else if (lowerMsg.startsWith("line") && lowerMsg.split(" ").length <= 2) {
    let lineMatch = lowerMsg.match(/line\s*(\d+)/);
    if (lineMatch) {
      let lineNum = lineMatch[1];
      let text = `⚙️ ประวัติปัญหาล่าสุดของ Line ${lineNum}:\n\n`;
      let count = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i][5] == lineNum) {
          let date = rows[i][1] ? rows[i][1].split(" ")[0] : "-";
          let job = rows[i][6] || "-", dept = rows[i][10], startTime = rows[i][11] || "-", fixTime = rows[i][12] || "-", secFixed = rows[i][13] || "-";
          let prob = rows[i][14] || "ไม่ได้ระบุ", detail = rows[i][15] || "ไม่มีรายละเอียด";

          text += `🏭 [Line ${lineNum}] Job ${job} แผนก: ${dept}\n📅 วันที่: ${date}\n⏰ เวลาเริ่มปัญหา: ${startTime}\n⏱️ ระยะเวลาแก้ไข: ${fixTime} นาที\n🔧 Section ที่แก้ไข: ${secFixed}\n⚠️ ปัญหาที่เกิด: ${prob}\n📝 รายละเอียด: ${detail}\n━━━━━━━━━━━━━\n\n`;
          count++;
          if (count >= 3) break;
        }
      }
      if (count > 0) return text.trim();
    }
  }

  // ==========================================
  // Default: คำสั่งไม่ถูกต้อง — แสดงคำแนะนำ
  // ==========================================
  return "พิมพ์คำสั่งไม่ถูกต้องครับ ลองพิมพ์แบบนี้นะ:\n👉 วันนี้มีอะไรไหม\n👉 เดือนนี้มี loss เท่าไหร่\n👉 อาทิตย์นี้มี loss เท่าไหร่\n👉 ล่าสุด\n👉 เมื่อคืน\n👉 สรุปวันที่ 8/9/2026";
}
