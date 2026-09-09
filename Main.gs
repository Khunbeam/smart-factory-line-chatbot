// ==========================================
// Main.gs — จุดเข้าหลัก (Webhook + Reply)
// ==========================================
// 📌 ไฟล์นี้เป็นจุดรับ Webhook จาก LINE
//    และฟังก์ชันส่งข้อความตอบกลับ
// ==========================================

/**
 * ฟังก์ชันสำหรับกด "เรียกใช้" (Run) ใน Editor เพียงครั้งเดียว
 * เพื่อให้ระบบแสดงหน้าต่าง "ให้สิทธิ์เข้าถึง" (Authorization) ของ DriveApp
 */
function setupPermissions() {
  DriveApp.getFiles();
  Logger.log("✅ อนุญาตสิทธิ์เรียบร้อยแล้ว บอทพร้อมทำงาน!");
}


/**
 * doPost — รับ Webhook จาก LINE Platform
 * 
 * ลำดับการทำงาน:
 *   1. ลองใช้ AI (GPT-4o-mini) วิเคราะห์ก่อน
 *   2. ถ้า AI ตอบไม่ได้ → สลับไปใช้ระบบคีย์เวิร์ด
 *   3. ส่งคำตอบกลับผ่าน LINE API
 *
 * @param {Object} e — POST event จาก LINE Webhook
 * @return {TextOutput} — ส่ง 'OK' กลับให้ LINE Platform
 */
function doPost(e) {
  let events;
  try {
    events = JSON.parse(e.postData.contents).events;
  } catch (err) {
    return ContentService.createTextOutput("OK"); // กรณีรับ payload ผิดฟอร์แมต
  }

  if (events && events.length > 0) {
    for (let i = 0; i < events.length; i++) {
      let event = events[i];
      if (event && event.type === 'message') {
        const replyToken = event.replyToken;

        // กรณีส่งข้อความปกติ (Text)
        if (event.message.type === 'text') {
          const userMessage = event.message.text.trim();
          const lowerMsg = userMessage.toLowerCase();

          // 0. ตรวจจับคำสั่ง Export ก่อน
          const exportKeywords = ['export', 'ขอไฟล์', 'เอาไฟล์', 'ดาวน์โหลด', 'download', 'ส่งไฟล์', 'โหลด', 'ขอข้อมูล excel', 'ขอ excel', 'ขอ pdf'];
          const isExportCommand = exportKeywords.some(k => lowerMsg.includes(k));

          if (isExportCommand) {
            let isRequestingAll = lowerMsg.includes("ทั้งหมด") || lowerMsg.includes("all");
            let monthInfo = extractTargetMonthInfo(userMessage);

            if (!isRequestingAll && !monthInfo) {
              replyDownloadOptions(replyToken);
            } else {
              replyExportFlex(replyToken, userMessage);
            }
            continue;
          }

          // 0.5 ตรวจจับคำสั่งขอความช่วยเหลือ
          const helpKeywords = ['ช่วย', 'แนะนำ', 'เมนู', 'ทำอะไร', 'เริ่ม', 'help', 'menu', 'start', '?', 'คู่มือ', 'คำแนะนำ', 'สวัสดี', 'hi', 'hello', 'ดีครับ', 'ดีจ้า'];
          const isHelpRequest = helpKeywords.some(k => lowerMsg === k || lowerMsg.includes('แนะนำ'));
          
          if (isHelpRequest) {
             replyHelpMenu(replyToken, "👋 สวัสดีครับ! ผมคือบอทผู้ช่วยรายงาน\nนี่คือสิ่งที่ผมช่วยคุณได้ครับ 👇");
             continue;
          }

          let replyText = "";
          let aiErrorReason = "";

          // 1. ลองใช้งาน AI ก่อน 
          if (OPENAI_API_KEY !== "") {
            const aiData = getSheetDataForAI(userMessage);
            const aiResult = analyzeWithAI(userMessage, aiData);

            if (aiResult.success) {
              if (aiResult.text.trim().includes("OUT_OF_SCOPE")) {
                replyText = "";
                aiErrorReason = "AI มองว่าคำถามนี้ไม่ได้เกี่ยวกับการวิเคราะห์ปัญหาในโรงงาน (OUT_OF_SCOPE)";
              } else {
                replyText = aiResult.text;
              }
            } else {
              aiErrorReason = aiResult.text;
            }
          }

          // 2. ถ้า AI ไม่ตอบ ให้สลับมาใช้คีย์เวิร์ด
          if (!replyText) {
            const fullData = getSheetDataFull();
            replyText = processKeyword(userMessage, fullData);

            if (replyText.includes("พิมพ์คำสั่งไม่ถูกต้อง") && aiErrorReason !== "") {
              replyHelpMenu(replyToken, `⚠️ ขออภัยครับ ผมยังไม่เข้าใจคำถามครับ\n(สาเหตุ: ${aiErrorReason})\n\n💡 ลองถามผมตามหมวดหมู่ด้านล่างนี้ได้เลยครับ 👇`);
              continue;
            }
            
            if (replyText.includes("พิมพ์คำสั่งไม่ถูกต้อง")) {
              replyHelpMenu(replyToken, "⚠️ ขออภัยครับ ผมยังไม่เข้าใจคำถามนี้ครับ\n\n💡 ลองใช้งานตามหมวดหมู่ด้านล่างนี้ได้เลยครับ 👇");
              continue;
            }
          }

          replyToLine(replyToken, replyText);
        } 
        // กรณีส่งสติ๊กเกอร์ (Sticker)
        else if (event.message.type === 'sticker') {
          replyHelpMenu(replyToken, "ขออภัยครับ ตอนนี้ผมยังไม่เข้าใจสติ๊กเกอร์ครับ 🙏\nรบกวนพิมพ์เป็นข้อความ หรือเลือกใช้งานตามหมวดหมู่ด้านล่างนี้ได้เลยครับ 👇");
        }
      }
    }
  }
  return ContentService.createTextOutput('OK');
}

/**
 * replyToLine — ส่งข้อความตอบกลับไปยัง LINE
 * 
 * จำกัดความยาวข้อความไม่เกิน 4,500 ตัวอักษร (LINE limit = 5,000)
 * หากยาวเกินจะตัดและแจ้งให้ผู้ใช้ถามเจาะจงขึ้น
 *
 * @param {string} replyToken — Reply Token จาก LINE event
 * @param {string} text — ข้อความที่ต้องการส่งกลับ
 */
function replyToLine(replyToken, text) {
  if (text && text.length > 4500) {
    text = text.substring(0, 4500) + "\n\n... (ข้อมูลยาวเกินไป กรุณาระบุคำถามให้เจาะจงขึ้นครับ)";
  }

  const url = 'https://api.line.me/v2/bot/message/reply';
  const options = {
    'method': 'post',
    'headers': {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN
    },
    'payload': JSON.stringify({
      'replyToken': replyToken,
      'messages': [{ 'type': 'text', 'text': text }]
    }),
    'muteHttpExceptions': true
  };
  try {
    UrlFetchApp.fetch(url, options);
  } catch(e) {
    console.error("replyToLine Error: ", e);
  }
}

/**
 * replyDownloadOptions — ส่งคำถามเมื่อต้องการดึงไฟล์ (อัปเกรดเป็น Flex Message)
 */
function replyDownloadOptions(replyToken) {
  const flexMessage = {
    "type": "flex",
    "altText": "เลือกไฟล์ที่ต้องการดาวน์โหลด",
    "contents": {
      "type": "bubble",
      "direction": "ltr",
      "header": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "ดาวน์โหลดข้อมูล",
            "weight": "bold",
            "size": "lg",
            "color": "#FFFFFF",
            "align": "center"
          }
        ],
        "backgroundColor": "#27ACB2"
      },
      "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": "กรุณาระบุเดือน หรือเลือกข้อมูล\nที่ต้องการดาวน์โหลดด้านล่างนี้ครับ 👇",
            "wrap": true,
            "align": "center",
            "color": "#666666"
          }
        ]
      },
      "footer": {
        "type": "box",
        "layout": "vertical",
        "spacing": "sm",
        "contents": [
          {
            "type": "button",
            "style": "primary",
            "color": "#E5A01D",
            "action": {
              "type": "message",
              "label": "โหลดทั้งหมด (Database)",
              "text": "โหลดทั้งหมด"
            }
          },
          {
            "type": "button",
            "style": "primary",
            "color": "#E74C3C",
            "action": {
              "type": "message",
              "label": "สรุปปัญหา (Loss) เดือนนี้",
              "text": "โหลดปัญหาเดือนนี้"
            }
          },
          {
            "type": "button",
            "style": "primary",
            "color": "#1DB446",
            "action": {
              "type": "message",
              "label": "พลังงานไฟฟ้า เดือนนี้",
              "text": "โหลดพลังงานเดือนนี้"
            }
          }
        ]
      }
    }
  };

  const url = 'https://api.line.me/v2/bot/message/reply';
  const options = {
    'method': 'post',
    'headers': {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN
    },
    'payload': JSON.stringify({
      'replyToken': replyToken,
      'messages': [flexMessage]
    }),
    'muteHttpExceptions': true
  };
  try {
    UrlFetchApp.fetch(url, options);
  } catch(e) {
    console.error("replyDownloadOptions Error: ", e);
  }
}

/**
 * replyHelpMenu — ส่งข้อความคู่มือการใช้งาน (User Guide)
 * @param {string} replyToken 
 * @param {string} prependText - ข้อความอารัมภบทที่จะส่งนำหน้า Flex Message
 */
function replyHelpMenu(replyToken, prependText) {
  const bubbles = [
    {
      "type": "bubble",
      "header": {
        "type": "box",
        "layout": "vertical",
        "backgroundColor": "#E74C3C",
        "contents": [
          { "type": "text", "text": "🏭 ปัญหาเครื่องจักร", "color": "#FFFFFF", "weight": "bold", "size": "md" }
        ]
      },
      "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          { "type": "text", "text": "สอบถามบันทึกสาเหตุเครื่องจักรหยุด หรือปัญหาตามวัน-เวลา", "size": "xs", "color": "#777777", "wrap": true },
          { "type": "separator", "margin": "md" },
          { "type": "text", "text": "ตัวอย่างคำถาม:", "size": "sm", "weight": "bold", "margin": "md" }
        ]
      },
      "footer": {
        "type": "box",
        "layout": "vertical",
        "spacing": "sm",
        "contents": [
           { "type": "button", "style": "secondary", "height": "sm", "action": { "type": "message", "label": "ปัญหาเมื่อวาน", "text": "ปัญหาเมื่อวานมีอะไรบ้าง?" } },
           { "type": "button", "style": "secondary", "height": "sm", "action": { "type": "message", "label": "ปัญหาของเดือน 7", "text": "สรุปปัญหาจุกจิกของเดือน 7 ให้หน่อย" } }
        ]
      }
    },
    {
      "type": "bubble",
      "header": {
        "type": "box",
        "layout": "vertical",
        "backgroundColor": "#E5A01D",
        "contents": [
           { "type": "text", "text": "⚡ พลังงานไฟฟ้า", "color": "#FFFFFF", "weight": "bold", "size": "md" }
        ]
      },
      "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          { "type": "text", "text": "สอบถามการเปรียบเทียบการใช้พลังงานไฟฟ้าของแต่ละโมดูล", "size": "xs", "color": "#777777", "wrap": true },
          { "type": "separator", "margin": "md" },
          { "type": "text", "text": "ตัวอย่างคำถาม:", "size": "sm", "weight": "bold", "margin": "md" }
        ]
      },
      "footer": {
        "type": "box",
        "layout": "vertical",
        "spacing": "sm",
        "contents": [
           { "type": "button", "style": "secondary", "height": "sm", "action": { "type": "message", "label": "พลังงานเดือนนี้", "text": "พลังงานเดือนนี้เท่าไหร่?" } },
           { "type": "button", "style": "secondary", "height": "sm", "action": { "type": "message", "label": "สรุปพลังงานมกราคม", "text": "สรุปการใช้ไฟเดือนมกราคม" } }
        ]
      }
    },
    {
      "type": "bubble",
      "header": {
        "type": "box",
        "layout": "vertical",
        "backgroundColor": "#27ACB2",
        "contents": [
           { "type": "text", "text": "📊 ดึงไฟล์รายงาน", "color": "#FFFFFF", "weight": "bold", "size": "md" }
        ]
      },
      "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          { "type": "text", "text": "ดาวน์โหลดไฟล์ Excel/PDF โปรดระบุหมวดหมู่และเดือนเสมอ", "size": "xs", "color": "#777777", "wrap": true },
          { "type": "separator", "margin": "md" },
          { "type": "text", "text": "ตัวอย่างคำสั่ง:", "size": "sm", "weight": "bold", "margin": "md" }
        ]
      },
      "footer": {
        "type": "box",
        "layout": "vertical",
        "spacing": "sm",
        "contents": [
           { "type": "button", "style": "secondary", "height": "sm", "action": { "type": "message", "label": "โหลดไฟล์ปัญหา (เดือนนี้)", "text": "โหลดปัญหาเดือนนี้" } },
           { "type": "button", "style": "secondary", "height": "sm", "action": { "type": "message", "label": "โหลดไฟล์พลังงานสิงหาคม", "text": "โหลดพลังงานสิงหาคม" } }
        ]
      }
    }
  ];

  const flexObj = {
    "type": "flex",
    "altText": "คู่มือการใช้งานบอท",
    "contents": {
      "type": "carousel",
      "contents": bubbles
    }
  };

  const payloadStr = JSON.stringify({
    'replyToken': replyToken,
    'messages': [
       { "type": "text", "text": prependText },
       flexObj
    ]
  });

  try {
    UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
      'method': 'post',
      'headers': {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN
      },
      'payload': payloadStr,
      'muteHttpExceptions': true
    });
  } catch (e) {
    console.error("replyHelpMenu Error: ", e);
  }
}

/**
 * replyExportFlex — ส่ง Flex Message ปุ่มดาวน์โหลด PDF / Excel
 *
 * @param {string} replyToken — Reply Token จาก LINE event
 * @param {string} userMessage — ข้อความจากผู้ใช้สำหรับคัดกรองเดือน (ถ้ามี)
 */
function replyExportFlex(replyToken, userMessage) {
  let finalSpreadsheetId = SPREADSHEET_ID;
  let isFiltered = false;
  let targetMonthName = "";
  
  const lowerMsg = userMessage ? userMessage.toLowerCase() : "";
  const wantEnergy = lowerMsg.includes("ไฟ") || lowerMsg.includes("พลังงาน") || lowerMsg.includes("solar");
  const wantLoss = lowerMsg.includes("ปัญหา") || lowerMsg.includes("loss") || lowerMsg.includes("เครื่องจักร");
  
  const monthInfo = userMessage ? extractTargetMonthInfo(userMessage) : null;
  
  if (monthInfo) {
    targetMonthName = monthInfo.thaiName;
    try {
      // สร้างไฟล์ชั่วคราว
      const newSs = SpreadsheetApp.create("รายงาน_" + targetMonthName);
      const newSsId = newSs.getId();
      
      // แชร์ไฟล์ให้ทุกคนที่มีลิงก์เข้าถึงได้ (ครอบ try-catch ป้องกันเรื่อง Permission องค์กร)
      try {
        DriveApp.getFileById(newSsId).setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (shareErr) {
        Logger.log("ไม่สามารถแชร์สาธารณะได้เนื่องจากนโยบายองค์กร: " + shareErr);
      }
      const sourceSs = SpreadsheetApp.openById(SPREADSHEET_ID);
      
      // ============================================
      // 1. จัดการชีท Chatbot Database
      // ============================================
      if (!wantEnergy || wantLoss) { 
        const lossSheetBackup = sourceSs.getSheetByName("Chatbot Database");
        if (lossSheetBackup) {
          // 1. ดึง Data สมบูรณ์จากต้นฉบับก่อน เพื่อป้องกันสูตรพัง ( #REF! ) ตอนข้ามไฟล์
          let allValues = lossSheetBackup.getDataRange().getDisplayValues();
          
          const newLossSheet = lossSheetBackup.copyTo(newSs);
          newLossSheet.setName("📋 Chatbot Database");
          
          // 2. ทับ Header คืนค่า ป้องกันสูตร Header เป็น #REF!
          if (allValues.length > 0) {
             newLossSheet.getRange(1, 1, 1, allValues[0].length).setValues([allValues[0]]);
          }
          
          let filteredRows = [];
          for (let i = 1; i < allValues.length; i++) { 
            let row = allValues[i];
            let dateStr = row[1];
            if (!dateStr || dateStr.toString().trim() === "") continue; 
            
            let m = null;
            let dateObj = new Date(dateStr);
            if (!isNaN(dateObj.getTime())) {
              m = dateObj.getMonth() + 1;
              let mMatch = dateStr.toString().trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-]/);
              if (mMatch) {
                let p1 = parseInt(mMatch[1], 10);
                let p2 = parseInt(mMatch[2], 10);
                m = (p1 > 12) ? p2 : p2;
              }
            }
            if (!m && typeof dateStr === 'string') {
               let mi = extractTargetMonthInfo(dateStr);
               if (mi) m = mi.monthNum;
            }
            
            if (m === monthInfo.monthNum) {
               filteredRows.push(row);
            }
          }
          
          let lastRow = newLossSheet.getLastRow();
          if (lastRow > 1) { // ลบ Data เดิมออกทั้งหมดแต่คง Format
             newLossSheet.getRange(2, 1, lastRow - 1, newLossSheet.getLastColumn()).clearContent();
          }
          
          if (filteredRows.length > 0) { // วางข้อมูลที่ผ่านการกรอง
             newLossSheet.getRange(2, 1, filteredRows.length, filteredRows[0].length).setValues(filteredRows);
          }
          
          let totalRowsData = 1 + filteredRows.length; 
          let rowsToKeep = Math.max(totalRowsData, newLossSheet.getFrozenRows() + 1);
          let maxRows = newLossSheet.getMaxRows();
          if (maxRows > rowsToKeep) { // ลบแถวเปล่าส่วนเกิน
             newLossSheet.deleteRows(rowsToKeep + 1, maxRows - rowsToKeep);
          }
        }
      }
      
      // ============================================
      // 2. จัดการชีท พลังงาน
      // ============================================
      if (!wantLoss || wantEnergy) {
        const energySheetBackup = sourceSs.getSheetByName("พลังงาน");
        if (energySheetBackup) {
          // ดึง Data สมบูรณ์มาก่อน เพื่อใช้วิเคราะห์หา Block
          let allValues = energySheetBackup.getDataRange().getDisplayValues();
          
          let latestBlockStart = -1;
          let latestBlockEnd = -1;
          
          // สแกนเพื่อหาว่า Block เริ่มและจบที่บรรทัดไหนบ้าง
          let blocks = [];
          let currentBlock = null;
          
          for (let i = 0; i < allValues.length; i++) {
            let row = allValues[i];
            let foundYearCol = -1;
            // สแกนหาคำว่า YEAR ในแถวนั้นๆ (คอลัมน์ไหนก็ได้)
            for (let c = 0; c < row.length - 1; c++) {
               if (row[c] && row[c].toString().trim().toUpperCase() === "YEAR") {
                  foundYearCol = c;
                  break;
               }
            }
            
            if (foundYearCol !== -1) {
              // ปิด Block ก่อนหน้า
              if (currentBlock) {
                 currentBlock.end = i - 1; 
                 blocks.push(currentBlock);
              }
              
              let mNum = -1;
              let yNum = null;
              let dateTxt = "";
              
              // ควานหาเดือนถัดจากคอลัมน์ YEAR ไปเรื่อยๆ (ข้าม merge cells / ช่องว่าง)
              for (let k = 1; k < 15 && (foundYearCol + k) < row.length; k++) {
                 let cellTxt = row[foundYearCol + k].toString().trim();
                 if (cellTxt !== "") {
                    let mi = extractTargetMonthInfo(cellTxt);
                    if (mi) {
                       mNum = mi.monthNum;
                       yNum = mi.yearNum;
                       dateTxt = cellTxt;
                       break; // เจอแล้ว หยุดหา
                    }
                 }
              }
              
              // ถ้าควานหาด้วย extractTargetMonthInfo ไม่เจอ ลองแค่หา Year เฉยๆ
              if (mNum === -1) {
                  for (let k = 1; k < 15 && (foundYearCol + k) < row.length; k++) {
                     let cellTxt = row[foundYearCol + k].toString().trim();
                     if (cellTxt !== "") {
                        dateTxt = cellTxt;
                        let ymatch = cellTxt.match(/((?:20|25)\d{2})/);
                        if (ymatch) {
                           yNum = parseInt(ymatch[1], 10);
                           if (yNum > 2500) yNum -= 543;
                        }
                        break;
                     }
                  }
              }
              
              currentBlock = { start: i, end: allValues.length - 1, monthNum: mNum, yearNum: yNum, label: dateTxt };
            }
          }
          if (currentBlock) blocks.push(currentBlock);
          
          // หา Block ล่าสุดที่ตรงกับเดือน (และปีถ้ามีการระบุ)
          let targetBlock = null;
          for (let i = blocks.length - 1; i >= 0; i--) {
             if (blocks[i].monthNum === monthInfo.monthNum) {
                if (monthInfo.yearNum !== null) {
                   if (blocks[i].yearNum === monthInfo.yearNum) {
                      targetBlock = blocks[i];
                      break;
                   }
                } else {
                   targetBlock = blocks[i];
                   break;
                }
             }
          }
          
          if (targetBlock) {
             const newEnergySheet = energySheetBackup.copyTo(newSs);
             newEnergySheet.setName("⚡ พลังงาน");
             
             // ปลดล๊อคแถวที่แช่แข็งไว้ (Frozen) ทั้งหมด ก่อนทำการ Delete เพื่อล้างบัคของ Google Sheets ห้ามลบแถว Frozen
             if (newEnergySheet.getFrozenRows() > 0) newEnergySheet.setFrozenRows(0);
             if (newEnergySheet.getFrozenColumns() > 0) newEnergySheet.setFrozenColumns(0);
             
             let bStart = targetBlock.start;
             let bEnd = targetBlock.end;
             let numRows = bEnd - bStart + 1;
             
             // 1. ทับข้อมูล Values เฉพาะของ Block ในที่เดิม เพื่อป้องกัน #REF!
             let blockValues = allValues.slice(bStart, bEnd + 1);
             newEnergySheet.getRange(bStart + 1, 1, numRows, allValues[0].length).setValues(blockValues);
             
             // 2. ลบแถวส่วนเกินข้างใต้ Block (หลังสุด)
             let maxRows = newEnergySheet.getMaxRows();
             if (maxRows > bEnd + 1) {
                newEnergySheet.deleteRows(bEnd + 2, maxRows - (bEnd + 1));
             }
             // 3. ลบแถวส่วนเกินข้างบน Block (บนสุด) - รูปแบบฟอร์แมตทั้งหมดจะถูกเลื่อนขึ้นไปเป็นแถว 1 อย่างสมบูรณ์แบบ
             if (bStart > 0) {
                newEnergySheet.deleteRows(1, bStart);
             }
          } else {
             // ถ้าไม่เจอเดือนนั้นในชีทพลังงานเลย
             const newEnergySheet = energySheetBackup.copyTo(newSs);
             newEnergySheet.setName("⚡ พลังงาน (ไม่มีข้อมูล)");
             newEnergySheet.clear();
          }
        }
      }

      // ลบ Sheet1 ที่ติดมาเป็นหน้าแรกสุด
      newSs.deleteSheet(newSs.getSheets()[0]); 
      finalSpreadsheetId = newSsId;
      isFiltered = true;
      
    } catch(e) {
      // หากเกิดข้อผิดพลาด ให้ fallback กลับไปที่ชีทหลัก และเก็บ error ไปแสดง
      finalSpreadsheetId = SPREADSHEET_ID; 
      isFiltered = false;
      targetMonthName = "Error: " + e.message; // ยัดใส่ตัวแปรนี้ชั่วคราวเพื่อส่งไปแสดงผล
    }
  }

  // ============================================
  // ดึง GID ของแต่ละชีทเพื่อใช้สร้างปุ่มดาวน์โหลด เลือกซ่อนชีทที่ไม่ตรงเงื่อนไข
  // ============================================
  const baseUrl = `https://docs.google.com/spreadsheets/d/${finalSpreadsheetId}/export`;
  let tab1Gid = "0";
  let tab2Gid = "376573553";
  let noticeText = "เลือกรูปแบบไฟล์ที่ต้องการดาวน์โหลด";
  
  if (isFiltered) {
    try {
      const ssDynamic = SpreadsheetApp.openById(finalSpreadsheetId);
      const sheets = ssDynamic.getSheets();
      // ค้นหา GID ใหม่ของการโหลด
      sheets.forEach(sh => {
        if (sh.getName().includes("Chatbot Database")) tab1Gid = sh.getSheetId();
        if (sh.getName().includes("พลังงาน")) tab2Gid = sh.getSheetId();
      });
      noticeText = `(ข้อมูลเฉพาะเดือน${targetMonthName})`;
    } catch(e) {}
  } else if (monthInfo && targetMonthName.startsWith("Error")) {
     // แสดง Error ในแชท เพื่อให้รู้ตัวว่าระบบแคช (เช่นยังไม่อนุญาตสิทธิ์)
     noticeText = `⚠️ ไม่สามารถสร้างไฟล์แยกเดือนได้ (${targetMonthName}) กรุณากดปุ่มเพื่อโหลดข้อมูลทั้งหมดแทน`;
  }

  
  let validTabs = [];
  if (isFiltered) {
     if (!wantEnergy || wantLoss) validTabs.push({ name: "📋 Chatbot Database", gid: tab1Gid });
     if (!wantLoss || wantEnergy) validTabs.push({ name: "⚡ พลังงาน", gid: tab2Gid });
  } else {
     if (!wantEnergy || wantLoss) validTabs.push({ name: "📋 Chatbot Database", gid: "0" });
     if (!wantLoss || wantEnergy) validTabs.push({ name: "⚡ พลังงาน", gid: "376573553" });
  }
  
  if (validTabs.length === 0) { // Fallback 
     validTabs.push({ name: "📋 Chatbot Database", gid: "0" });
     validTabs.push({ name: "⚡ พลังงาน", gid: "376573553" });
  }

  const bubbles = validTabs.map(function(tab) {
    return {
      "type": "bubble",
      "size": "kilo",
      "header": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": tab.name,
            "weight": "bold",
            "size": "lg",
            "color": "#FFFFFF"
          }
        ],
        "backgroundColor": "#27ACB2",
        "paddingAll": "15px"
      },
      "body": {
        "type": "box",
        "layout": "vertical",
        "contents": [
          {
            "type": "text",
            "text": noticeText,
            "size": "sm",
            "color": "#555555",
            "wrap": true
          }
        ],
        "paddingAll": "15px"
      },
      "footer": {
        "type": "box",
        "layout": "vertical",
        "spacing": "sm",
        "contents": [
          {
            "type": "button",
            "style": "primary",
            "color": "#1DB446",
            "action": {
              "type": "uri",
              "label": "📊 ดาวน์โหลด Excel",
              "uri": baseUrl + "?format=xlsx&gid=" + tab.gid
            },
            "height": "sm"
          },
          {
            "type": "button",
            "style": "primary",
            "color": "#E74C3C",
            "action": {
              "type": "uri",
              "label": "📄 ดาวน์โหลด PDF",
              "uri": baseUrl + "?format=pdf&gid=" + tab.gid
            },
            "height": "sm"
          }
        ],
        "paddingAll": "15px"
      }
    };
  });

  const flexMessage = {
    "type": "flex",
    "altText": "📥 ดาวน์โหลดข้อมูล",
    "contents": {
      "type": "carousel",
      "contents": bubbles
    }
  };

  const url = 'https://api.line.me/v2/bot/message/reply';
  const options = {
    'method': 'post',
    'headers': {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + LINE_ACCESS_TOKEN
    },
    'payload': JSON.stringify({
      'replyToken': replyToken,
      'messages': [flexMessage]
    })
  };
  UrlFetchApp.fetch(url, options);
}
