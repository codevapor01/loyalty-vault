/**
 * ═══════════════════════════════════════════════════
 * LoyaltyVault — Google Apps Script Backend
 * Deploy as Web App (Execute as: Me, Access: Anyone)
 * ═══════════════════════════════════════════════════
 *
 * Google Sheet must have 3 tabs:
 *   - "Customers"  → Headers: Name | Phone | JoinDate
 *   - "Coupons"    → Headers: Name | Phone | CouponCode | Discount | Source | Expiry | CreatedAt
 *   - "Settings"   → Row 1 headers: SerialCode | Discount1 | Discount2 | Discount3 | BhagyadaChakramEnabled | MalliRaaBaksheeshEnabled
 *                     Row 2 default: (Empty) | 5 | 10 | 15 | true | true
 */

function doPost(e) {
  var start = new Date();
  try {
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var result;

    switch (action) {
      case 'getSettings': result = respond(getSettings()); break;
      case 'saveSettings': result = respond(saveSettings(body)); break;
      case 'addCustomer': result = respond(addCustomer(body)); break;
      case 'getCustomers': result = respond(getCustomers()); break;
      case 'deleteCustomer': result = respond(deleteCustomer(body)); break;
      case 'addCoupon': result = respond(addCoupon(body)); break;
      case 'getCoupons': result = respond(getCoupons(body)); break;
      case 'getAllCoupons': result = respond(getAllCoupons()); break;
      case 'eraseAll': result = respond(eraseAll()); break;
      case 'ping': result = respond({ status: 'awake' }); break;
      case 'cleanExpired': result = respond(cleanExpiredCoupons()); break;
      case 'ownerLogin':
        if (String(body.name).toLowerCase() === 'admin' && body.password === 'admin@12') {
          result = respond({ success: true, token: 'AH_OWNER_2024_SECURE' });
        } else {
          result = respond({ success: false, message: 'Invalid credentials' });
        }
        break;
      case 'checkPlayed': result = respond(checkPlayed(body)); break;
      case 'setPlayed': result = respond(setPlayed(body)); break;
      case 'getBillCodes': result = respond(getBillCodes()); break;
      case 'addBillCode': result = respond(addBillCode(body)); break;
      case 'verifyBillCode': result = respond(verifyBillCode(body)); break;
      default: result = respond({ status: 'error', message: 'Unknown action: ' + action }); break;
    }

    var duration = new Date() - start;
    if (duration > 5000) {
      Logger.log("SLOW ACTION: " + action + " took " + duration + "ms");
    }
    return result;
  } catch (err) {
    return respond({ status: 'error', message: err.toString() });
  }
}

function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'ping') {
    return ContentService.createTextOutput(JSON.stringify({ status: 'awake' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // Allow GET for testing — mirrors doPost if 'action' param exists
  if (e && e.parameter && e.parameter.action) {
    return doPost({ postData: { contents: JSON.stringify(e.parameter) } });
  }
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok', message: 'LoyaltyVault API is running.' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// Handle CORS preflight OPTIONS requests
function doOptions(e) {
  return ContentService
    .createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT);
}


function respond(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ─────── HELPERS ───────
function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

function findRowByPhone(sheet, phone) {
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === String(phone).trim()) {
      return { rowIndex: i + 1, rowData: data[i] };
    }
  }
  return null;
}

// ═══════════════════════════════
// SETTINGS
// ═══════════════════════════════
function getSettings() {
  var sheet = getSheet('Settings');
  if (!sheet) return { status: 'error', message: 'Settings sheet not found' };

  var lastRow = sheet.getLastRow();
  
  // Auto-initialize defaults if row 2 doesn't exist or is empty
  if (lastRow < 2) {
    sheet.getRange(2, 2).setValue(5);
    sheet.getRange(2, 3).setValue(10);
    sheet.getRange(2, 4).setValue(15);
    sheet.getRange(2, 5).setValue(true);
    sheet.getRange(2, 6).setValue(true);
  }

  var data = sheet.getRange(2, 1, 1, 6).getValues()[0];
  
  // Fallback if cells are still empty
  var discount1 = Number(data[1]) || 5;
  var discount2 = Number(data[2]) || 10;
  var discount3 = Number(data[3]) || 15;
  
  // Boolean conversions for toggles (default to true if undefined)
  var bhagyadaChakramEnabled = data[4] !== "" ? (String(data[4]).toLowerCase() === 'true') : true;
  var malliRaaBaksheeshEnabled = data[5] !== "" ? (String(data[5]).toLowerCase() === 'true') : true;

  return {
    status: 'ok',
    data: {
      discount1: discount1,
      discount2: discount2,
      discount3: discount3,
      bhagyadaChakramEnabled: bhagyadaChakramEnabled,
      malliRaaBaksheeshEnabled: malliRaaBaksheeshEnabled
    }
  };
}

function saveSettings(body) {
  var sheet = getSheet('Settings');
  if (!sheet) return { status: 'error', message: 'Settings sheet not found' };

  sheet.getRange(2, 2).setValue(Number(body.discount1));
  sheet.getRange(2, 3).setValue(Number(body.discount2));
  sheet.getRange(2, 4).setValue(Number(body.discount3));
  sheet.getRange(2, 5).setValue(body.bhagyadaChakramEnabled === true || body.bhagyadaChakramEnabled === 'true');
  sheet.getRange(2, 6).setValue(body.malliRaaBaksheeshEnabled === true || body.malliRaaBaksheeshEnabled === 'true');

  return { status: 'ok', message: 'Settings saved.' };
}

// ═══════════════════════════════
// CUSTOMERS
// ═══════════════════════════════
function addCustomer(body) {
  var sheet = getSheet('Customers');
  if (!sheet) return { success: false, message: 'Customers sheet not found' };

  var name = String(body.name).trim();
  var phone = String(body.phone).trim();
  var now = new Date().toISOString();

  var existing = findRowByPhone(sheet, phone);
  if (existing) {
    return {
      success: true,
      isNew: false,
      message: 'Welcome back, ' + existing.rowData[0] + '!',
      name: existing.rowData[0],
      phone: existing.rowData[1],
      joinDate: existing.rowData[2],
      playedMode: existing.rowData[3] || "",
      playedAt: existing.rowData[4] || ""
    };
  }

  // Add new customer
  sheet.appendRow([name, phone, now, '', '']);
  return { 
    success: true, 
    message: 'Welcome, ' + name + '! Account created.', 
    isNew: true, 
    name: name,
    phone: phone,
    joinDate: now,
    playedMode: "",
    playedAt: ""
  };
}

function getCustomers() {
  var sheet = getSheet('Customers');
  if (!sheet) return { status: 'error', message: 'Customers sheet not found' };

  var data = sheet.getDataRange().getValues();
  var customers = [];
  var limit = Math.min(data.length, 201);
  for (var i = 1; i < limit; i++) {
    if (String(data[i][0]).trim() === '') continue;
    customers.push({
      n: data[i][0],
      p: String(data[i][1]),
      j: data[i][2],
      pm: data[i][3] || ''
    });
  }
  return { status: 'ok', data: customers, hasMore: data.length > 201 };
}

function checkPlayed(body) {
  var sheet = getSheet('Customers');
  if (!sheet) return { status: 'error', message: 'Customers sheet not found' };

  var phone = String(body.phone).trim();
  var existing = findRowByPhone(sheet, phone);
  if (existing) {
    var playedMode = String(existing.rowData[3] || '').trim();
    var playedAt = String(existing.rowData[4] || '').trim();
    return { played: playedMode !== '', mode: playedMode, playedAt: playedAt };
  }
  return { played: false, mode: '', playedAt: '' };
}

function setPlayed(body) {
  var sheet = getSheet('Customers');
  if (!sheet) return { status: 'error', message: 'Customers sheet not found' };

  var phone = String(body.phone).trim();
  var mode = String(body.mode || '');
  
  var existing = findRowByPhone(sheet, phone);
  if (existing) {
    sheet.getRange(existing.rowIndex, 4, 1, 2).setValues([[mode, new Date().toISOString()]]);
    return { success: true };
  }
  return { success: false, message: 'Customer not found' };
}

function deleteCustomer(body) {
  var sheet = getSheet('Customers');
  if (!sheet) return { status: 'error', message: 'Customers sheet not found' };

  var phone = String(body.phone).trim();
  var existing = findRowByPhone(sheet, phone);
  if (existing) {
    sheet.deleteRow(existing.rowIndex);
    deleteCouponsByPhone(phone);
    return { status: 'ok', message: 'Customer deleted.' };
  }
  return { status: 'error', message: 'Customer not found.' };
}

function deleteCouponsByPhone(phone) {
  var sheet = getSheet('Coupons');
  if (!sheet) return;
  var data = sheet.getDataRange().getValues();
  for (var i = data.length - 1; i >= 1; i--) {
    if (String(data[i][1]).trim() === phone) {
      sheet.deleteRow(i + 1);
    }
  }
}

// ═══════════════════════════════
// COUPONS
// ═══════════════════════════════
function addCoupon(body) {
  var sheet = getSheet('Coupons');
  if (!sheet) return { status: 'error', message: 'Coupons sheet not found' };

  var row = [
    String(body.name),
    String(body.phone),
    String(body.couponCode),
    Number(body.discount),
    String(body.source),
    String(body.expiry),
    new Date().toISOString()
  ];

  sheet.appendRow(row);
  return { status: 'ok', message: 'Coupon saved!' };
}

function getCoupons(body) {
  var sheet = getSheet('Coupons');
  if (!sheet) return { status: 'error', message: 'Coupons sheet not found' };

  var phone = String(body.phone).trim();
  var data = sheet.getDataRange().getValues();
  var coupons = [];

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][1]).trim() === phone) {
      coupons.push({
        n: data[i][0],
        p: String(data[i][1]),
        c: data[i][2],
        d: data[i][3],
        s: data[i][4],
        e: data[i][5],
        ca: data[i][6]
      });
    }
  }
  return { status: 'ok', data: coupons };
}

function getAllCoupons() {
  var sheet = getSheet('Coupons');
  if (!sheet) return { status: 'error', message: 'Coupons sheet not found' };

  var data = sheet.getDataRange().getValues();
  var coupons = [];
  var limit = Math.min(data.length, 201);

  for (var i = 1; i < limit; i++) {
    if (String(data[i][0]).trim() === '') continue;
    coupons.push({
      n: data[i][0],
      p: String(data[i][1]),
      c: data[i][2],
      d: data[i][3],
      s: data[i][4],
      e: data[i][5],
      ca: data[i][6]
    });
  }
  return { status: 'ok', data: coupons, hasMore: data.length > 201 };
}

// ═══════════════════════════════
// ERASE ALL
// ═══════════════════════════════
function eraseAll() {
  var custSheet = getSheet('Customers');
  var coupSheet = getSheet('Coupons');

  if (custSheet) {
    var maxRows = custSheet.getMaxRows();
    var maxCols = custSheet.getMaxColumns();
    if (maxRows > 1 && maxCols > 0) {
      custSheet.getRange(2, 1, maxRows - 1, maxCols).clearContent();
    }
  }

  if (coupSheet) {
    var maxRows2 = coupSheet.getMaxRows();
    var maxCols2 = coupSheet.getMaxColumns();
    if (maxRows2 > 1 && maxCols2 > 0) {
      coupSheet.getRange(2, 1, maxRows2 - 1, maxCols2).clearContent();
    }
  }

  return { status: 'ok', message: 'All customer and coupon data erased.' };
}

function cleanExpiredCoupons() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var couponSheet = ss.getSheetByName('Coupons');
  var customerSheet = ss.getSheetByName('Customers');
  
  var now = new Date();
  var expiredPhones = [];

  // ── STEP 1: Find expired coupons ──
  if (couponSheet) {
    var couponData = couponSheet.getDataRange().getValues();
    for (var i = couponData.length - 1; i >= 1; i--) {
      var expiry = new Date(couponData[i][5]);
      if (expiry < now) {
        expiredPhones.push(String(couponData[i][1]).trim());
        couponSheet.deleteRow(i + 1);
      }
    }
  }

  // ── STEP 2: Find expired Bhagyada Chakram customers (2hr rule) ──
  if (customerSheet) {
    var customerData = customerSheet.getDataRange().getValues();
    for (var j = customerData.length - 1; j >= 1; j--) {
      var phone = String(customerData[j][1]).trim();
      var playedMode = String(customerData[j][3]).trim();
      var playedAt = new Date(customerData[j][4]);

      if (playedMode === 'Bhagyada Chakram') {
        var twoHoursLater = new Date(playedAt.getTime() + 2 * 60 * 60 * 1000);
        if (now > twoHoursLater) {
          expiredPhones.push(phone);
        }
      }
    }

    // ── STEP 3: Delete expired customers from Customers sheet ──
    var customerData2 = customerSheet.getDataRange().getValues();
    for (var k = customerData2.length - 1; k >= 1; k--) {
      var phone2 = String(customerData2[k][1]).trim();
      if (expiredPhones.indexOf(phone2) !== -1) {
        customerSheet.deleteRow(k + 1);
        Logger.log('Deleted customer: ' + phone2);
      }
    }
  }

  Logger.log('Cleanup complete. Removed: ' + expiredPhones.length + ' customers');
  return { success: true };
}
function removeDuplicateCustomers() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Customers");
  const data = sheet.getDataRange().getValues();
  const seenPhones = new Set();
  
  for (let i = data.length - 1; i >= 1; i--) {
    const phone = String(data[i][1]).trim();
    if (seenPhones.has(phone)) {
      sheet.deleteRow(i + 1);
      Logger.log("Removed duplicate: " + phone);
    } else {
      seenPhones.add(phone);
    }
  }
  Logger.log("Duplicate cleanup complete");
}

// ═══════════════════════════════
// BILLING CODES
// ═══════════════════════════════

function _initBillCodesSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('BillCodes');
  if (!sheet) {
    sheet = ss.insertSheet('BillCodes');
    sheet.appendRow(['BillCode', 'CustomerName', 'CustomerPhone', 'BillAmount', 'Status', 'RedeemedAt']);
  }
  return sheet;
}

function getBillCodes() {
  var sheet = _initBillCodesSheet();
  var data = sheet.getDataRange().getValues();
  var codes = [];
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim() === '') continue;
    codes.push({
      code: String(data[i][0]),
      name: String(data[i][1]),
      phone: String(data[i][2]),
      amount: String(data[i][3]),
      status: String(data[i][4]),
      redeemedAt: String(data[i][5])
    });
  }
  return { status: 'ok', data: codes };
}

function addBillCode(body) {
  var sheet = _initBillCodesSheet();
  var newCode = String(body.code).trim();
  var cName = String(body.customerName || '').trim();
  var cPhone = String(body.phone || '').trim();
  var cAmount = String(body.amount || '').trim();

  if (!newCode) return { status: 'error', message: 'Code cannot be empty' };

  // Check if exists
  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === newCode.toLowerCase()) {
      return { status: 'error', message: 'This bill code already exists' };
    }
  }

  sheet.appendRow([newCode, cName, cPhone, cAmount, 'UNUSED', '']);
  return { status: 'ok', message: 'Billing code added' };
}

function approveBillCode(body) {
  var sheet = _initBillCodesSheet();
  var codeToVerify = String(body.code).trim();

  if (!codeToVerify) return { status: 'error', message: 'Invalid billing code' };

  var data = sheet.getDataRange().getValues();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === codeToVerify.toLowerCase()) {
      var status = String(data[i][4]).trim();
      var redeemedAt = String(data[i][5]).trim();
      if (status === 'REDEEMED') {
        return { status: 'error', message: 'This bill code has already been redeemed on ' + (redeemedAt || 'an earlier date') };
      }
      // Valid and UNUSED -> mark as REDEEMED
      var rowIndex = i + 1;
      var now = new Date().toLocaleString();
      sheet.getRange(rowIndex, 5).setValue('REDEEMED');
      sheet.getRange(rowIndex, 6).setValue(now);
      
      return { status: 'ok', message: 'Success' };
    }
  }
  
  return { status: 'error', message: 'No bill code found. Please check the code and try again' };
}
