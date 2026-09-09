// ==========================================
// DataService.gs — ดึงข้อมูลจาก Google Sheets
// ==========================================
// 📌 ไฟล์นี้รวมฟังก์ชันดึงข้อมูลทั้งหมด:
//    - getSheetDataForAI()    → ดึงข้อมูล Loss แบบกรอง (สำหรับ AI)
//    - getSheetDataFull()     → ดึงข้อมูลแบบเต็ม (สำหรับคีย์เวิร์ด)
//    - getElectricSheetData() → ดึงข้อมูลไฟฟ้า/พลังงาน
// ==========================================

/**
 * getSheetDataForAI — ดึงข้อมูล Loss จากชีท 'Chatbot Database' แบบกรองอัจฉริยะ
 *
 * กรองข้อมูลตาม:
 *   - เดือนเป้าหมาย (จากคำถามภาษาไทย/อังกฤษ)
 *   - คีย์เวิร์ดใน query (Job, Lot, Line, แผนก ฯลฯ)
 * 
 * ⚡ ถ้า query เกี่ยวกับไฟฟ้า/พลังงาน → สลับไปเรียก getElectricSheetData() แทน
 *
 * ผลลัพธ์จะถูกจัดรูปแบบเป็นข้อความสรุปสถิติตามแผนก + ข้อมูลรายบรรทัดดิบ
 * เพื่อส่งเป็น context ให้ AI วิเคราะห์
 *
 * @param {string} query — คำถามจากผู้ใช้
 * @return {string} — ข้อมูลที่จัดรูปแบบแล้วสำหรับส่งให้ AI
 */
function getSheetDataForAI(query) {
  const lowerQuery = query ? query.toLowerCase() : "";

  // ⚡ [ตัวสลับราง] ตรวจจับคีย์เวิร์ดไฟฟ้า → โยนไปฟังก์ชันดึงชีทไฟฟ้า
  const electricKeywords = ["ไฟ", "ไฟฟ้า", "พลังงาน", "kwh", "mdb", "โซล่า", "solar", "pea", "มิเตอร์"];
  if (electricKeywords.some(k => lowerQuery.includes(k))) {
    return getElectricSheetData(query);
  }

  // 🔧 ดึงข้อมูล Loss จากชีท 'Chatbot Database'
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Chatbot Database');
  if (!sheet) return "ไม่มีข้อมูล";

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return "ไม่มีข้อมูล";

  const allData = sheet.getRange(2, 1, lastRow - 1, 16).getDisplayValues();
  const validRows = allData.filter(row => row[1] && row[1].toString().trim() !== "");

  if (validRows.length === 0) return "ไม่มีข้อมูล";

  const numRowsToFetch = Math.min(6000, validRows.length);
  const dataToProcess = validRows.slice(-numRowsToFetch);

  let filteredIndices = new Set();

  // --- ตรวจจับเดือนเป้าหมายจากคำถาม ---
  let targetMonth = null;
  const thaiMonthPatterns = [
    { m: 1, regex: /มกร|ม\.?ค\.?/i }, { m: 2, regex: /กุมภ|ก\.?พ\.?/i },
    { m: 3, regex: /มีน|มี\.?ค\.?/i }, { m: 4, regex: /เมษ|เม\.?ย\.?/i },
    { m: 5, regex: /พฤษภ|พ\.?ค\.?/i }, { m: 6, regex: /มิถุน|มิ\.?ย\.?/i },
    { m: 7, regex: /กรกฎ|ก\.?ค\.?/i }, { m: 8, regex: /สิงห|ส\.?ค\.?/i },
    { m: 9, regex: /กันย|ก\.?ย\.?/i }, { m: 10, regex: /ตุล|ต\.?ค\.?/i },
    { m: 11, regex: /พฤศจิก|พ\.?ย\.?/i }, { m: 12, regex: /ธันว|ธ\.?ค\.?/i }
  ];

  for (let p of thaiMonthPatterns) {
    if (p.regex.test(lowerQuery)) { targetMonth = p.m; break; }
  }

  // --- ตรวจจับ วันนี้ / เมื่อคืน / เมื่อวาน ---
  let targetDate = null;
  let targetShift = null; // เพิ่มการตรวจสอบกะ (Shift)
  let now = new Date();
  
  if (lowerQuery.includes("วันนี้")) {
     targetDate = { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
     if (lowerQuery.includes("เมื่อคืน") || lowerQuery.includes("กะดึก") || lowerQuery.includes("night")) targetShift = "Night";
     else if (lowerQuery.includes("กลางวัน") || lowerQuery.includes("กะเช้า") || lowerQuery.includes("day")) targetShift = "Day";
  } else if (lowerQuery.includes("เมื่อคืน") || lowerQuery.includes("เมื่อวาน")) {
     let yesterday = new Date();
     yesterday.setDate(yesterday.getDate() - 1);
     targetDate = { y: yesterday.getFullYear(), m: yesterday.getMonth() + 1, d: yesterday.getDate() };
     if (lowerQuery.includes("เมื่อคืน") || lowerQuery.includes("กะดึก") || lowerQuery.includes("night")) targetShift = "Night";
     else if (lowerQuery.includes("กลางวัน") || lowerQuery.includes("เช้า") || lowerQuery.includes("day")) targetShift = "Day";
  }

  if (!targetMonth && !targetDate) {
    let mMatch = lowerQuery.match(/(?:เดือน|\bm)\s*(\d{1,2})/i);
    if (mMatch) {
      let n = parseInt(mMatch[1], 10);
      if (n >= 1 && n <= 12) targetMonth = n;
    }
  }

  if (!targetMonth && (lowerQuery.includes("เจาะลึก") || lowerQuery.includes("รายละเอียด") || lowerQuery.includes("แผนก"))) {
    let now = new Date();
    targetMonth = now.getMonth() + 1;
  }

  /**
   * getMonthFromRowDate — ดึงเลขเดือนจากสตริงวันที่ในแถว
   * @param {string} dateVal — ค่าจากคอลัมน์วันที่
   * @return {number|null} — เลขเดือน (1-12) หรือ null
   */
  function getMonthFromRowDate(dateVal) {
    if (!dateVal) return null;
    let s = dateVal.toString().trim().split(" ")[0];
    let parts = s.split(/[-/]/);
    if (parts.length < 3) return null;
    if (parts[0].length === 4) return parseInt(parts[1], 10);
    else {
      let p0 = parseInt(parts[0], 10), p1 = parseInt(parts[1], 10);
      if (p1 > 12) return p0; if (p0 > 12) return p1; return p0;
    }
  }

  // --- สร้างคีย์เวิร์ดค้นหาจาก query ---
  const engNumWords = lowerQuery.match(/[a-z0-9]+/g) || [];
  const thaiWords = lowerQuery.match(/[ก-๙]+/g) || [];
  const excludeWords = ["job", "lot", "line", "loss", "มีอะไรบ้าง", "เกิดอะไรขึ้น", "วิเคราะห์", "ให้หน่อย", "สรุป", "ปัญหา", "มากที่สุด", "คือ", "อะไร", "ใบ", "speed", "section", "เดือน", "เจาะลึก", "ขอรายละเอียด"];
  const searchTerms = [...engNumWords, ...thaiWords].filter(k => !excludeWords.includes(k) && k.length >= 1);

  // --- กรองข้อมูลตามเดือน วันที่ และคีย์เวิร์ด ---
  for (let i = 0; i < dataToProcess.length; i++) {
    const rowDateStr = dataToProcess[i][1];
    
    // หาค่า Date จากแถว
    let rY = null, rM = null, rD = null;
    let dObj = new Date(rowDateStr);
    if (!isNaN(dObj.getTime())) {
       rY = dObj.getFullYear();
       rM = dObj.getMonth() + 1;
       rD = dObj.getDate();
    }
    // ใช้ string match ดักถ้าพิมพ์ DD/MM/YYYY
    let mMatchStr = rowDateStr.toString().trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
    if (mMatchStr) {
       let p1 = parseInt(mMatchStr[1], 10);
       let p2 = parseInt(mMatchStr[2], 10);
       rY = parseInt(mMatchStr[3], 10);
       rD = (p1 > 12) ? p2 : p1;
       rM = (p1 > 12) ? p1 : p2;
    }
    
    let isMonthMatch = (targetMonth !== null && rM === targetMonth);
    let isDateMatch = (targetDate !== null && rY === targetDate.y && rM === targetDate.m && rD === targetDate.d);
    
    // ตรวจสอบ Shift ให้ต้องตรงกันเป๊ะถ้าเจาะจง
    let shiftMatch = true;
    if (targetShift !== null) {
       let shiftVal = dataToProcess[i][4] ? dataToProcess[i][4].toString().trim().toLowerCase() : "";
       if (shiftVal !== targetShift.toLowerCase()) {
          shiftMatch = false;
       }
    }

    const rowStr = dataToProcess[i].join(" ").toLowerCase();
    const isKeywordMatch = searchTerms.some(term => {
      if (/^[a-z0-9]+$/i.test(term)) return new RegExp("\\b" + term + "\\b", "i").test(rowStr);
      else return rowStr.includes(term);
    });

    if (shiftMatch && (isDateMatch || isMonthMatch || (targetMonth === null && targetDate === null && searchTerms.length > 0 && isKeywordMatch))) {
      filteredIndices.add(i);
    }
  }

  // Fallback: ถ้าไม่เจอข้อมูลเลย → ดึง 200 แถวล่าสุด (แต่ห้ามใช้Fallbackถ้าระบุวันที่/เดือนเป้าหมายแล้ว)
  if (targetMonth === null && targetDate === null && filteredIndices.size === 0) {
    const startIndex = Math.max(0, dataToProcess.length - 200);
    for (let i = startIndex; i < dataToProcess.length; i++) {
      filteredIndices.add(i);
    }
  }

  let finalIndices = Array.from(filteredIndices).sort((a, b) => a - b);
  
  if (finalIndices.length === 0) {
    return "ไม่พบข้อมูลในระบบ หรือไม่มีการบันทึกรายงานในช่วงเวลา/กะที่คุณถามครับ";
  }

  // 1. สรุปภาพรวมแบบนับยอดเบื้องต้นในฝั่งเซิร์ฟเวอร์ (คำนวณจากทุกรายการแบบ 100% ครบทั้งปี/เดือน)
  let deptSummaryMap = {};
  for (let idx of finalIndices) {
    let row = dataToProcess[idx];
    let deptName = row[10] ? row[10].toString().trim().toUpperCase() : "ไม่ระบุแผนก";
    if (deptName === "" || deptName === "-") deptName = "ไม่ระบุแผนก";
    let fixTime = parseFloat(row[12]) || 0;
    let prob = row[14] ? row[14].toString().trim() : "ไม่ระบุปัญหา";

    if (!deptSummaryMap[deptName]) deptSummaryMap[deptName] = { count: 0, fixTime: 0, probs: {} };
    deptSummaryMap[deptName].count++;
    deptSummaryMap[deptName].fixTime += fixTime;
    
    // นับจำนวนความถี่ของแต่ละปัญหาในแผนกนั้น
    if (prob !== "" && prob !== "-") {
      deptSummaryMap[deptName].probs[prob] = (deptSummaryMap[deptName].probs[prob] || 0) + 1;
    }
  }

  let compactData = "=== 1. สรุปสถิติภาพรวม (คำนวณจากชุดข้อมูลแบบ 100% ไม่ถูกตัด) ===\n";
  for (let dept in deptSummaryMap) {
    let d = deptSummaryMap[dept];
    // เรียงลำดับปัญหาที่พบบ่อยสุด 3 อันดับแรก
    let sortedProbs = Object.keys(d.probs).sort((a, b) => d.probs[b] - d.probs[a]).slice(0, 3);
    let topProbsText = sortedProbs.map(p => `${p}(${d.probs[p]}ครั้ง)`).join(", ");
    
    compactData += `🏢 แผนก ${dept}: เกิดปัญหาทั้งหมด ${d.count} ครั้ง | เวลารวม ${d.fixTime} นาที | ปัญหาที่เจอบ่อย: ${topProbsText || '-'}\n`;
  }

  // 2. ข้อมูลรายบรรทัดดิบ จำกัดแค่ 300 บรรทัดล่าสุด (เพื่อไม่ให้ OpenAI API ตีกลับ HTTP 429 Rate Limit)
  compactData += "\n=== 2. ข้อมูลรายบรรทัดดิบ (ใช้อ้างอิงเมื่อให้แจกแจงรายวัน/เหตุการณ์) ===\n";
  let limitRows = finalIndices.slice(-300);
  let rowNum = 1; // ตัวนับลำดับเพื่อให้ AI อ่านข้อมูลง่ายขึ้น ไม่ข้ามบรรทัด 23:30
  for (let idx of limitRows) {
    let row = dataToProcess[idx];
    let speed = parseFloat(row[8]) || 0;
    let machineSec = parseFloat(row[9]) || 1;
    let startTime = row[11] ? row[11].toString().trim() : "-";
    let fixTime = parseFloat(row[12]) || 0;
    let fixSec = parseFloat(row[13]) || 0;
    let deptName = row[10] ? row[10].toString().trim().toUpperCase() : "-";

    let lossAmount = 0;
    if (machineSec > 0) lossAmount = Math.round((speed / machineSec) * fixSec * fixTime);

    compactData += `[รายการ ${rowNum}] วันที่:${row[1]}|กะ:${row[4]}|Line:${row[5]}|Job:${row[6]}|Lot:${row[7]}|แผนก:${deptName}|เริ่ม:${startTime}|แก้:${fixTime}นาที|สูญเสีย:${lossAmount}ใบ|ปัญหา:${row[14]}|รายละเอียด:${row[15]}\n`;
    rowNum++;
  }
  return compactData;
}



/**
 * getSheetDataFull — ดึงข้อมูลแบบเต็มสำหรับระบบคีย์เวิร์ด
 *
 * ดึง 200 แถวล่าสุดจากชีท 'Chatbot Database'
 * ใช้เป็น fallback เมื่อ AI ไม่สามารถตอบได้
 *
 * @return {Object} — { rows: string[][] }
 */
function getSheetDataFull() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('Chatbot Database');
  if (!sheet) return { headers: [], rows: [] };
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { headers: [], rows: [] };
  const allData = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getDisplayValues();
  const validRows = allData.filter(row => row[1] && row[1].toString().trim() !== "");
  const numRowsToFetch = Math.min(200, validRows.length);
  return { rows: validRows.slice(-numRowsToFetch) };
}

/**
 * getElectricSheetData — ดึงข้อมูลไฟฟ้า/พลังงานจากชีท 'พลังงาน'
 *
 * ดึงข้อมูลย้อนหลัง 150 แถวล่าสุด ครอบคลุมเดือนปัจจุบัน+เดือนก่อนหน้า
 * จัดรูปแบบเป็นข้อความที่ AI อ่านง่าย
 *
 * คอลัมน์หลัก:
 *   - Col C (Index 2): F1 TOTAL (เตา 1)
 *   - Col H (Index 7): Electric Booting
 *   - Col M (Index 12): F2 TOTAL (เตา 2)
 *   - Col T (Index 19): F3 TOTAL (เตา 3)
 *   - Col U (Index 20): SUM F1+F2+F3
 *   - Col Y (Index 24): SOLAR
 *   - Col Z (Index 25): SUM AMR+SOLAR
 *   - Col AA (Index 26): ผลต่าง
 *
 * @param {string} query — คำถามจากผู้ใช้ (ไม่ได้ใช้ในตอนนี้ แต่สงวนไว้สำหรับกรองเฉพาะเดือน)
 * @return {string} — ข้อมูลไฟฟ้าที่จัดรูปแบบแล้ว
 */
function getElectricSheetData(query) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('พลังงาน');
  if (!sheet) return "ไม่พบชีทชื่อ 'พลังงาน' ในระบบครับ";

  const lastRow = sheet.getLastRow();
  if (lastRow < 4) return "ไม่มีข้อมูลไฟฟ้า";

  // ดึงย้อนหลังเยอะหน่อยเพื่อให้ครอบคลุมหลายเดือน
  const startRow = Math.max(1, lastRow - 300);
  const numRows = lastRow - startRow + 1;
  const allData = sheet.getRange(startRow, 1, numRows, 27).getDisplayValues();

  // 1. วิเคราะห์คำถามว่าผู้บริหารระบุเดือนอะไรเบื้องต้น
  const q = query.toLowerCase();
  const monthMap = {
    "มกรา": "JANUARY", "กุมภา": "FEBRUARY", "มีนา": "MARCH", "เมษา": "APRIL",
    "พฤษภา": "MAY", "มิถุนา": "JUNE", "กรกฎา": "JULY", "สิงหา": "AUGUST",
    "กันยา": "SEPTEMBER", "ตุลา": "OCTOBER", "พฤศจิกา": "NOVEMBER", "ธันวา": "DECEMBER",
    "jan": "JANUARY", "feb": "FEBRUARY", "mar": "MARCH", "apr": "APRIL",
    "may": "MAY", "jun": "JUNE", "jul": "JULY", "aug": "AUGUST",
    "sep": "SEPTEMBER", "oct": "OCTOBER", "nov": "NOVEMBER", "dec": "DECEMBER"
  };
  
  let targetMonth = "";
  for (let key in monthMap) {
    if (q.includes(key)) {
      targetMonth = monthMap[key];
      break;
    }
  }

  // 2. จัดกลุ่มข้อมูลแยกตามเดือน (ป้องกัน AI ตาหรอกจับแพะชนแกะผิดเดือน)
  let monthlyData = {};
  let currentMonthBlock = "ไม่ระบุเดือน";
  let lastFoundMonth = "";

  for (let i = 0; i < allData.length; i++) {
    let row = allData[i];
    let rowText = row.join("").trim();
    if (!rowText) continue;

    let colA = row[0] ? row[0].toString().trim() : "";   
    let colB = row[1] ? row[1].toString().trim() : "";   
    let colS = row[18] ? row[18].toString().trim() : ""; 
    let colT = row[19] ? row[19].toString().trim() : ""; 
    let colU = row[20] ? row[20].toString().trim() : ""; 

    if (colS.toUpperCase() === "YEAR") {
      currentMonthBlock = `${colT} ${colU}`.trim();
      lastFoundMonth = currentMonthBlock;
      if (!monthlyData[currentMonthBlock]) {
        monthlyData[currentMonthBlock] = `\n[--- บล็อกข้อมูลประจำเดือน: ${currentMonthBlock} ---]\n`;
      }
      continue;
    }

    if (!monthlyData[currentMonthBlock]) monthlyData[currentMonthBlock] = "";

    let f1_total = row[2] || "-";      
    let booting = row[7] || "-";       
    let f2_total = row[12] || "-";     
    let f3_total = row[19] || "-";     
    let sum_f123 = row[20] || "-";     
    let solar = row[24] || "-";        
    let sum_supply = row[25] || "-";   
    let diff = row[26] || "-";         

    let dayNum = colA !== "" && !isNaN(colA) ? colA : colB;

    if ((colA === "" || isNaN(colA)) && (colB === "" || isNaN(colB)) && (f1_total !== "-" || sum_f123 !== "-")) {
      monthlyData[currentMonthBlock] += `📌 [สรุปยอดรวมประจำเดือน ${currentMonthBlock}] -> F1 TOTAL:${f1_total} kWh | Booting:${booting} kWh | F2 TOTAL:${f2_total} kWh | F3 TOTAL:${f3_total} kWh | รวมใช้ไฟ(SUM):${sum_f123} kWh | โซล่า:${solar} kWh | แหล่งจ่ายรวม:${sum_supply} kWh | ผลต่าง:${diff} kWh\n`;
    }
    else if (dayNum !== "" && !isNaN(dayNum) && parseInt(dayNum, 10) >= 1 && parseInt(dayNum, 10) <= 31) {
      monthlyData[currentMonthBlock] += `วันที่ ${dayNum} ${currentMonthBlock} -> F1 TOTAL:${f1_total} kWh | Booting:${booting} kWh | F2 TOTAL:${f2_total} kWh | F3 TOTAL:${f3_total} kWh | รวมใช้ไฟ:${sum_f123} kWh | โซล่า:${solar} kWh | ผลต่าง:${diff} kWh\n`;
    }
  }

  // 3. ฟิลเตอร์ส่งแค่เดือนที่ถูกถามเท่านั้น
  let compactData = "=== ข้อมูลตารางไฟฟ้าจากชีท 'พลังงาน' ===\n\n";
  
  if (targetMonth !== "") {
    let found = false;
    for (let monthKey in monthlyData) {
      if (monthKey.toUpperCase().includes(targetMonth)) {
        compactData += monthlyData[monthKey];
        found = true;
      }
    }
    if (!found) {
      return `ระบบไม่มีข้อมูลไฟฟ้าของเดือน '${targetMonth}' ในหน้าชีทครับ`;
    }
  } else {
    // ถ้าไม่ระบุเดือน ให้เอาเดือนล่าสุดท้ายสุด (lastFoundMonth) ไปตัวเดียวพอ
    if (lastFoundMonth !== "" && monthlyData[lastFoundMonth]) {
      compactData += monthlyData[lastFoundMonth];
    } else {
      for (let monthKey in monthlyData) {
        compactData += monthlyData[monthKey];
      }
    }
  }

  return compactData;
}

/**
 * extractTargetMonthInfo — แยกเดือนจากข้อความ คืนค่าข้อมูลเดือน (ถ้ามี)
 *
 * @param {string} query
 * @return {Object|null} — { monthNum: 8, engName: "AUGUST", thaiName: "สิงหาคม" }
 */
function extractTargetMonthInfo(query) {
  const lowerQuery = query.toLowerCase();
  
  // แปลงชื่อเดือนและรองรับการพิมพ์ผิด, ตัวย่อภาษาไทย/อังกฤษ
  const monthMap = [
    { num: 1, regex: /มกร|มก|ม\.?ค\.?|jan/i, eng: "JANUARY", th: "มกราคม" },
    { num: 2, regex: /กุมภ|กุ|ก\.?พ\.?|feb/i, eng: "FEBRUARY", th: "กุมภาพันธ์" },
    { num: 3, regex: /มีน|มี\.?ค\.?|mar/i, eng: "MARCH", th: "มีนาคม" },
    { num: 4, regex: /เมษ|เมย|เม\.?ย\.?|apr/i, eng: "APRIL", th: "เมษายน" },
    { num: 5, regex: /พฤษ|พค|พ\.?ค\.?|may/i, eng: "MAY", th: "พฤษภาคม" },
    { num: 6, regex: /มิถุน|มิย|มิ\.?ย\.?|jun/i, eng: "JUNE", th: "มิถุนายน" },
    { num: 7, regex: /กรก|กรกกฏ|กรฏ|กค|ก\.?ค\.?|jul/i, eng: "JULY", th: "กรกฎาคม" },
    { num: 8, regex: /สิงห|สิง|สค|ส\.?ค\.?|aug/i, eng: "AUGUST", th: "สิงหาคม" },
    { num: 9, regex: /กันย|กัน|กย|ก\.?ย\.?|sep/i, eng: "SEPTEMBER", th: "กันยายน" },
    { num: 10, regex: /ตุล|ตค|ต\.?ค\.?|oct/i, eng: "OCTOBER", th: "ตุลาคม" },
    { num: 11, regex: /พฤศ|พฤจ|พย|พ\.?ย\.?|nov/i, eng: "NOVEMBER", th: "พฤศจิกายน" },
    { num: 12, regex: /ธันว|ธว|ธค|ธ\.?ค\.?|dec/i, eng: "DECEMBER", th: "ธันวาคม" }
  ];

  // หาเลขปีถ้ามีการระบุ
  let yMatch = lowerQuery.match(/(?:ปี\s*|year\s*)?((?:20|25)\d{2})/i);
  let yearNum = null;
  if (yMatch) {
     let y = parseInt(yMatch[1], 10);
     if (y > 2500) y -= 543; // แปลง พ.ศ. เป็น ค.ศ.
     yearNum = y;
  }

  for (let p of monthMap) {
    if (p.regex.test(lowerQuery)) return { monthNum: p.num, engName: p.eng, thaiName: p.th, yearNum: yearNum };
  }

  // รองรับ "เดือนนี้" 
  if (lowerQuery.includes("เดือนนี้") || lowerQuery.includes("เดือนปัจจุบัน") || lowerQuery.includes("ปัจจุบัน") || lowerQuery.includes("ล่าสุด")) {
    let now = new Date();
    let pm = monthMap[now.getMonth()];
    return { monthNum: pm.num, engName: pm.eng, thaiName: pm.th, yearNum: now.getFullYear() };
  }

  // รองรับรูปแบบ "เดือน 8" หรือ "m8" หรือ "m 8"
  let mMatch = lowerQuery.match(/(?:เดือน|\bm)\s*(\d{1,2})/i);
  if (mMatch) {
    let n = parseInt(mMatch[1], 10);
    if (n >= 1 && n <= 12) {
      let pm = monthMap[n - 1];
      return { monthNum: pm.num, engName: pm.eng, thaiName: pm.th, yearNum: yearNum };
    }
  }

  return null;
}
