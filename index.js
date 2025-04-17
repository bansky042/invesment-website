const express = require('express');
let otpStorage = {}; // Store OTPs temporarily
const bodyParser = require('body-parser'); // Add body-parser for form data
const nodemailer = require('nodemailer');
const { Pool } = require('pg');
const path = require('path');
const ejs = require('ejs');
const bcrypt = require("bcryptjs");
const passport = require("passport");
const { Strategy } = require("passport-local");
const session = require("express-session");
const multer = require("multer");
const fs = require('fs');
const cookieParser = require('cookie-parser');
const flash = require("connect-flash");
const cron = require("node-cron");
const dotenv = require("dotenv");

dotenv.config();



function isLoggedIn(req, res, next) {
  if (req.isAuthenticated()) return next();
  res.redirect('/login');
}


// File storage config
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/deposits/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

// File filter (optional – only images/pdf)
const fileFilter = (req, file, cb) => {
  const allowedTypes = ["image/jpeg", "image/png", "application/pdf"];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only images and PDF files are allowed"), false);
  }
};

const upload = multer({ storage, fileFilter });


// Profile image storage
const profileStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/profile');
  },
  filename: function (req, file, cb) {
    const uniqueName = `${req.user.id}-${Date.now()}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});
const uploadProfile = multer({ storage: profileStorage });

const kycStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/kyc'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${req.user.id}-${Date.now()}${ext}`);
  }
});

const kycUpload = multer({
  storage: kycStorage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = /pdf|jpg|jpeg|png/;
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowedTypes.test(ext));
  }
});


const app = express();
app.use(bodyParser.urlencoded({ extended: true })); // Middleware to parse form data
const port = 4000;

app.use(cookieParser());
app.use("/uploads", express.static("uploads"));
app.use(express.static(path.join(__dirname, "public"))); // Serve static files from public directory
app.use(express.static("public"));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use((req, res, next) => {
  if (req.user) {
    res.locals.user = req.user;
    res.locals.users = [req.user];
    res.locals.walletAddress = req.user.wallet_address;
  }
  next();
});

const adminEmail = "abanakosisochukwu03@gmail.com";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false, // required by some providers
  }
});


// Run every hour (or adjust timing as needed)
cron.schedule("0 * * * *", async () => {
  console.log("⏳ Checking for matured investments...");

  try {
    // 1. Get all matured and active investments
    const { rows: maturedInvestments } = await pool.query(
      `SELECT * FROM investments 
       WHERE mature_at <= NOW() AND status = 'active'`
    );

    for (const investment of maturedInvestments) {
      const totalReturn = parseFloat(investment.total_return);
      const userId = investment.user_id;

      // 2. Update user's profit balance
      await pool.query(
        `UPDATE users 
         SET profit_balance = profit_balance + $1 
         WHERE id = $2`,
        [totalReturn, userId]
      );

      // 3. Update investment status
      await pool.query(
        `UPDATE investments 
         SET status = 'claimed' 
         WHERE id = $1`,
        [investment.id]
      );

      console.log(`💰 Investment ${investment.id} for user ${userId} matured and credited.`);
    }
  } catch (err) {
    console.error("❌ Error processing matured investments:", err);
  }
});

function requireKYCVerified(req, res, next) {
  if (req.user.kyc_status !== 'verified') {
    return res.render('kyc', {
      message: "You must complete and verify KYC to invest or withdraw."
    });
  }
  next();
}

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: "abanakosisochukwu03@gmail.com",
    pass: "lkwe ehad ybwd kcbg",
  },
});

const saltRounds = 10;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware to parse form data
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: "TOPWORLLDSECRET",
  resave: false,
  saveUninitialized: false,
  
  cookie: { maxAge: 1000 * 60 * 60 * 24 },
}));

app.use(passport.initialize());
app.use(passport.session());


app.use(flash());

app.use((req, res, next) => {
  res.locals.success_msg = req.flash("success_msg");
  res.locals.error_msg = req.flash("error_msg");
  next();
});

app.use((req, res, next) => {
  if (req.session && req.session.user) {
    req.user = req.session.user;
  }
  next();
});
function isAdmin(req, res, next) {
  if (req.isAuthenticated() && req.user && req.user.is_admin === true) {
    return next();
  }
  return res.status(403).send("Access Denied: Admins only.");
}




//const rewardReferral = async (referrerId) => {
 // const rewardAmount = 10; // or whatever you want
//  await pool.query(
 //   'UPDATE users SET referral_balance = referral_balance + $1 WHERE id = $2',
 //   [rewardAmount, referrerId]
//  );
//};

app.get("/kyc", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login"); // 🔐 Redirect if user is not logged in
  }

  try {
    // ✅ Fetch user wallet details
    const userResult = await pool.query(
      "SELECT wallet_address, coin_type FROM users WHERE id = $1",
      [req.user.id]
    );

    const user = userResult.rows[0];

    if (!user || !user.wallet_address) {
      return res.send(`<script>alert("Connect Wallet first!"); window.location.href = "/dashboard";</script>`);
    }

    const walletAddress = user.wallet_address;
    const coinType = user.coin_type;
    const message = req.session.kycMessage || null;

    // 🧹 Clear message after reading
    delete req.session.kycMessage;

    // ✅ Render KYC page with required data
    res.render("kyc", {
      message,
      walletAddress,
      coinType,
      user,
      users: [req.user] // for backward compatibility if needed in EJS
    });

  } catch (error) {
    console.error("Error loading KYC page:", error);
    res.status(500).send("An error occurred while loading the KYC page.");
  }
});

app.get("/login", (req, res) => res.render("login.ejs"));
// GET Route for Withdraw Page
app.get("/withdraw", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const result = await pool.query(
      "SELECT wallet_address, profit_balance FROM users WHERE id = $1",
      [req.user.id]
    );

    const user = result.rows[0];
    console.log("User:", user); // Debugging log
    if (!user.wallet_address) {
      return res.send(
        `<script>alert("Connect Wallet first!"); window.location.href = "/dashboard";</script>`
      );
    }

    // 🟢 Fetch withdrawal history
    const withdrawalsResult = await pool.query(
      "SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );
    const userWallet = await pool.query(
      'SELECT wallet_address, coin_type FROM users WHERE id = $1',
      [req.user.id]
    );
    
    const walletAddress = userWallet.rows[0]?.wallet_address;
   
    const withdrawals = withdrawalsResult.rows;
    const coinType = userWallet.rows[0]?.coin_type;

    res.render("withdraw", {
      user,
      message: req.session.message || null,
      withdrawals, // Pass it here
      user: req.user,
      users: [req.user],
      walletAddress,
      coinType,
      
    });

    req.session.message = null;
  } catch (err) {
    console.error(err);
    res.send("Error loading withdraw page");
  }
});


app.get('/admin/kyc-requests', isAdmin, async (req, res) => {
  const result = await pool.query("SELECT id, username, email, kyc_status, kyc_document FROM users WHERE kyc_document IS NOT NULL");
  res.render('kyc-requests', { users: result.rows });
});



app.get("/admin/withdrawals", isAdmin, async (req, res) => {
  try {
    const withdrawals = await pool.query(`
      SELECT w.*, u.username 
      FROM withdrawals w 
      JOIN users u ON w.user_id = u.id
      ORDER BY w.created_at DESC
    `);
    console.log("Withdrawals:", withdrawals.rows); // Debugging log
    res.render("admin-withdrawals", { withdrawals: withdrawals.rows });
  } catch (err) {
    console.error(err);
    res.send("Error fetching withdrawals");
  }
});

app.get("/admin/deposits", isAdmin, async (req, res) => {
  try {
    const deposits = await pool.query(`
      SELECT d.*, u.username, u.email, u.fullname 
      FROM deposits d 
      JOIN users u ON d.user_id = u.id
      ORDER BY d.created_at DESC
    `);
    console.log("Deposits:", deposits.rows); // Debugging log
    res.render("deposit-admin", { deposits: deposits.rows });
  } catch (err) {
    console.error(err);
    res.send("Error fetching deposits");
  }
});






// Define the correct directory where your files are stored
const uploadsDir = path.join(__dirname, 'uploads', 'deposits');

// Custom route to serve uploaded files
app.get('/admin/uploads/:filename', isAdmin, (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(uploadsDir, filename);
console.log("File path:", filePath); // Debugging log
  // Check if the file exists
  fs.exists(filePath, (exists) => {
    if (!exists) {
      return res.status(404).send('File not found');
    }

    // Send the file to the client
    res.sendFile(filePath);
  });
});

// ✅ Function to reward the referrer


// ✅ Optional: Check referral balance (for testing)
const checkReferralReward = async (referrerId) => {
  const res = await pool.query('SELECT referral_balance FROM users WHERE id = $1', [referrerId]);
  return res.rows[0].referral_balance;
};

// ✅ Route: Handle referral link (sets cookie)
app.get('/ref/:referralCode', async (req, res) => {
  const { referralCode } = req.params;

  const result = await pool.query(
    'SELECT username FROM users WHERE referral_code = $1',
    [referralCode]
  );

  if (result.rows.length === 0) {
    return res.send(`<h2 style="color:red;">Invalid referral code: ${referralCode}</h2><a href="/register">Continue to Register</a>`);
  }

  res.cookie('ref', referralCode, { maxAge: 7 * 24 * 60 * 60 * 1000 }); // 1 week
  res.redirect('/register');
});





app.get('/investment', async (req, res) => {
  const user = req.user;

  // Fetch user investments (assuming getUserInvestments is correct)
  const ongoing = await getUserInvestments(user.id); 

  // Fetch wallet address from the database
  const userWallet = await pool.query(
    "SELECT wallet_address FROM users WHERE id = $1",
    [req.user.id]
  );
  const walletAddress = userWallet.rows[0]?.wallet_address;
 
  console.log('Fetched Wallet Address:', walletAddress); // Check if wallet address is being fetched correctly

  // If no wallet address, log and handle error
  if (!walletAddress) {
    console.error("No wallet address found for the user.");
  }

  // Render the page and pass walletAddress to the view
  res.render('investment', {
    user,
    users: [user], // For navbar compatibility
    walletAddress, // Pass walletAddress here
    ongoing
  });
});



// GET Route for Withdrawal History



app.get('/history', async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.redirect("/login");

    const userId = req.user.id; // Get the logged-in user's ID from req.user

    // Get deposits for user
    const depositQuery = `
      SELECT amount, status, created_at
      FROM deposits
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    const depositResult = await pool.query(depositQuery, [userId]);

    // Normalize deposit status
    const deposits = depositResult.rows.map(d => ({
      ...d,
      status: d.status.trim().toLowerCase() === 'successful' ? 'approved' :
              d.status.trim().toLowerCase() === 'pending' ? 'pending' : 'rejected'
    }));

    // Get withdrawals for user
    const withdrawalQuery = `
      SELECT amount, status, created_at
      FROM withdrawals
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    const withdrawalResult = await pool.query(withdrawalQuery, [userId]);
    const userWallet = await pool.query(
      "SELECT wallet_address,coin_type FROM users WHERE id = $1",
      [req.user.id]
    );
    const walletAddress = userWallet.rows[0]?.wallet_address;
   const coinType = userWallet.rows[0]?.coin_type;
   console.log("Coin Type:", coinType); // Debugging log
    console.log("Withdrawal Result:", withdrawalResult.rows); // Debugging log
    console.log("Deposit Result:", depositResult.rows); // Debugging log
    // Normalize withdrawal status
    const withdrawals = withdrawalResult.rows.map(w => ({
      ...w,
      status: w.status.trim().toLowerCase() === 'successful' ? 'approved' :
              w.status.trim().toLowerCase() === 'pending' ? 'pending' : 'rejected'
    }));

    // Render the transaction history page with the normalized data
    res.render('history', {
      deposits,
      withdrawals,
      user: req.user,
      users: [req.user],
      walletAddress,
      coinType,
    });
  } catch (err) {
    console.error('Error fetching transaction history:', err);
    res.status(500).send('Server error');
  }
});




app.get("/dashboard", async (req, res) => {
  try {
    if (!req.isAuthenticated()) return res.redirect("/login");

    const userId = req.user.id;

    const { rows } = await pool.query(
      `SELECT id, username, profit_balance, wallet_address, coin_type, referral_balance, deposit_balance, profile_image,referral_code,kyc_status
       FROM users WHERE id = $1`,
      [userId]
    );
    

    const result = await pool.query(
      'SELECT * FROM investments WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC',
      [userId, 'active']
    );
    if (rows.length === 0) return res.redirect("/login");

    const currentUser = rows[0]; // ✅ FIX: Define currentUser
    const ongoing = result.rows;
    const referrals = await pool.query(
      "SELECT COUNT(*) FROM referrals WHERE referrer_id = $1",
      [userId]
    );

    const totalReferrals = referrals.rows[0].count;

    const referralLink = `${req.protocol}://${req.get("host")}/register?ref=${currentUser.referral_code}`;

    res.render("index.ejs", {
      user: currentUser, // ✅ FIXED: Now defined
      userId: currentUser.id,
      users: rows, // This is still an array, used for looping in EJS
      seedPhraseAccepted: req.session.seedPhraseAccepted || false,
      walletAddress: currentUser.wallet_address || "",
      coinType: currentUser.coin_type || "",

      totalReferrals,
      referralLink,
      depositBalance: currentUser.deposit_balance || 0,
      ongoing,
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).send("Error fetching user data.");
  }
});



// GET /register
app.get('/register', async (req, res) => {
  const referralCode = req.query.ref || req.cookies.ref || null;
  let referrerUsername = null;

  if (referralCode) {
    try {
      const referrer = await pool.query(
        'SELECT username FROM users WHERE referral_code = $1',
        [referralCode]
      );
      
      if (referrer.rows.length > 0) {
        referrerUsername = referrer.rows[0].username;
      }
    } catch (err) {
      console.error('Error checking referral code:', err);
    }
  }

  // Always pass referralCode from cookie if missing in query
  const fallbackReferralCode = referralCode || req.cookies.ref || null;

  res.render('register', {
    referralCode: fallbackReferralCode,
    referrerUsername,
    referralCode
  });
});




app.get("/settings", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }

  try {
    const userResult = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = userResult.rows[0];
    const walletAddress = user.wallet_address;
    const coinType = user.coin_type;
    const seedResult = await pool.query(
      "SELECT * FROM user_seed_phrases WHERE user_id = $1",
      [req.user.id]
    );
    const seed = seedResult.rows[0] || {};

    res.render("settings", { user, seed,
      users: [req.user],
      walletAddress,
      coinType,
     }); // now passing both `user` and `seed`
  } catch (err) {
    console.error("Error fetching user settings:", err);
    res.status(500).send("Server error");
  }
});



app.get("/forgottenpassword", (req, res) => res.render("forgottenPassword.ejs"));
app.get("/forgotpassword", (req, res) => res.render("forgotpassword.ejs"));
app.get("/verify-otp", (req, res) => res.render("otp.ejs"));
app.get("/withdrawals", async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  try {
    const { rows } = await pool.query(
      "SELECT * FROM withdrawals WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );
    const userWallet = await pool.query(
      "SELECT wallet_address FROM users WHERE id = $1",
      [req.user.id]
    );
    const walletAddress = userWallet.rows[0]?.wallet_address;
    console.log( { rows }); // Debugging log
    res.render("withdrawals.ejs", { withdrawals: rows,
      user: req.user,
      users: [req.user],
      walletAddress,
     });
  } catch (error) {
    console.error("Error fetching withdrawal history:", error);
    res.status(500).send("Error fetching withdrawal history.");
  }
});

app.get("/deposit",  async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login"); // Redirect to login if not authenticated
  }

  try {

    const result = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);;
    const userWallet = await pool.query(
      'SELECT wallet_address, coin_type FROM users WHERE id = $1',
      [req.user.id]
    );
    const walletAddress = userWallet.rows[0]?.wallet_address;
    const coinType = userWallet.rows[0]?.coin_type;
    if (!walletAddress) {
      return res.send(
        `<script>alert("Connect Wallet first!"); window.location.href = "/dashboard";</script>`
      );
    }
    const message = req.session.message;

    
    delete req.session.message;

    res.render("deposit", {
      user: req.user,
      walletAddress, // 🟢 pass this to EJS
      message,// or a flash message if needed
      users: [req.user],
      coinType,
      
  
    });
  } catch (error) {
    console.error("Error loading deposit page:", error);
    res.status(500).send("Server Error");
  }
});





app.get('/dashboard/investments', async (req, res) => {
  const userId = req.user.id;

  try {
    const investments = await pool.query(
      `SELECT * FROM investments WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    res.render('dashboard-investments', { investments: investments.rows });
  } catch (err) {
    console.error(err);
    res.send("Error fetching investments.");
  }
});

app.get('/invest', async (req, res) => {
  const userId = req.user?.id || 1; // fallback or real user ID

  try {
    const result = await pool.query(
      'SELECT * FROM investments WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC',
      [userId, 'active']
    );
    const userWallet = await pool.query(
      "SELECT wallet_address,coin_type FROM users WHERE id = $1",
      [req.user.id]
    );
    const walletAddress = userWallet.rows[0]?.wallet_address;
    const coinType = userWallet.rows[0]?.coin_type;
    const ongoing = result.rows;

    res.render('investment', { ongoing,
      user: req.user,
      walletAddress,
      users: [req.user],
      coinType,
     }); // ✅ PASS IT HERE
  } catch (error) {
    console.error('Error fetching ongoing investments:', error);
    res.render('investment', { ongoing: [],
      walletAddress,
      coinType,
     }); // ✅ PASS EMPTY ARRAY AS FALLBACK
  }
});



app.get('/invest/:plan', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login"); // Redirect to login if not authenticated
  }
  const plan = req.params.plan;
  const userId = req.user.id;
  

  const userResult = await pool.query('SELECT deposit_balance FROM users WHERE id = $1', [userId]);
  const depositBalance = userResult.rows[0]?.deposit_balance || 0;

  const plans = {
    basic: { min: 50, max: 500, percent: 40 },
    standard: { min: 550, max: 5000, percent: 75 },
    premium: { min: 5050, max: Infinity, percent: 100 }
  };

  const selectedPlan = plans[plan];

  if (!selectedPlan) {
    return res.status(404).send('Plan not found');
  }

  if (depositBalance < selectedPlan.min) {
    return res.render('investment', {
      ongoing: [],
      message: `Insufficient balance for ${plan} plan. You need at least $${selectedPlan.min}.`
    });
  }

  res.render('invest-form', {
    planName: plan,
    planDetails: selectedPlan,
    depositBalance,
    message: null
  });
});





app.get("/insertSeedPhrase", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login"); // Redirect to login if not authenticated
  }
  const userId = req.user?.id || null; // Use optional chaining to prevent errors
  console.log("User ID:", userId); // Debugging log

  if (!userId) {
    return res.status(400).send("User ID is missing or invalid.");
  }

  res.render("insertSeedPhrase.ejs", { userId }); // Pass userId to the view
});

app.get("/insertWalletAddress", (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login"); // Redirect to login if not authenticated
  }
  const userId = req.user?.id || null; // Use optional chaining to prevent errors
  console.log("User ID:", userId); // Debugging log

  if (!userId) {
    return res.status(400).send("User ID is missing or invalid.");
  }

  res.render("insertWalletAddress.ejs", { userId }); // Render the insertWalletAddress view
});





app.post("/submit-walletaddress", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login"); // Redirect if not authenticated
  }

  const userId = req.user.id; 
  const walletAddress = req.body.walletAddress; 
  const coinType = req.body.coinType; // Get the coin type from the form
  console.log("Coin Type:", coinType); // Debugging log
  // Log the wallet address and user ID for debugging
console.log("Wallet Address:", walletAddress); // Debugging log
  console.log("User ID:", userId); // Debugging log
  // Validate wallet address
  if (!walletAddress) {
    return res.status(400).send("Wallet address is required.");
  }

  try {
    await pool.query(
      'UPDATE users SET wallet_address = $1, coin_type = $2 WHERE id = $3',
      [walletAddress, coinType, userId]
    );
    console.log("Wallet address saved successfully!");
    res.redirect("/insertSeedPhrase"); // Redirect instead of sending a response
   
  } catch (err) {
    console.error("Error updating wallet address:", err);
    res.status(500).send("Server error");
  }
});


app.post("/disconnectWallet", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login"); // Redirect if not logged in
  }

  const userId = req.user.id; // Get the authenticated user’s ID

  try {
    // Remove wallet address from users table
    await pool.query("UPDATE users SET wallet_address = NULL WHERE id = $1", [userId]);
    await pool.query("UPDATE users SET coin_type = NULL WHERE id = $1", [userId]);
    // Delete the user's seed phrase entry from user_seed_phrases table
    await pool.query("DELETE FROM user_seed_phrases WHERE user_id = $1", [userId]);

    // Mark the seed phrase as "not accepted" in session
    req.session.seedPhraseAccepted = false;

    console.log("Wallet disconnected successfully!");

    // Redirect to the dashboard
    res.redirect("/dashboard");
  } catch (error) {
    console.error("Error disconnecting wallet:", error);
    res.status(500).send("Error disconnecting wallet.");
  }
});




app.get("/logout", (req, res) => {
  req.logout((err) => {
    if (err) return next(err);
    res.redirect("/login");
  });
});

app.post("/login", passport.authenticate("local", {
  successRedirect: "/dashboard",
  failureRedirect: "/login",
}));

app.post("/forgottenpassword", async (req, res) => {
  const { username: email, phoneNumber } = req.body;

  if (!email || !phoneNumber) {
    return res.status(400).send("Email and phone number are required.");
  }

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  await pool.query("INSERT INTO otps (email, otp) VALUES ($1, $2)", [email, otp]); // Store OTP in database
  console.log(`Stored OTP for ${email}: ${otp}`); // Debugging
  console.log(`OTP stored in database for ${email}`); // Additional debugging

  // Send OTP via email
  
  const mailOptions = {
    from: "abanakosisochukwu03@gmail.com",
    to: email,
    subject: 'Your OTP Code',
    text: `Your OTP code is ${otp}`,
  };

  transporter.sendMail(mailOptions, (error) => {
    if (error) return res.status(500).send('Error sending OTP');

    res.render("otp.ejs", { email: email }); // Make sure email is passed to OTP page
  });
});

app.post("/verify-otp", async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    console.log("Missing email or OTP in request body:", req.body);
    return res.status(400).send("Email and OTP are required.");
  }

  console.log(`Submitted OTP: ${otp}`);

  const result = await pool.query("SELECT * FROM otps WHERE email = $1 AND otp = $2", [email, otp]);
  console.log(`Query result for ${email}:`, result.rows); // Additional logging for debugging
  if (result.rows.length > 0) {
    res.render("forgotpassword.ejs"); // Render the forgotpassword page
    console.log(`Redirecting to forgotpassword page for ${email}`); // Additional debugging
    await pool.query("DELETE FROM otps WHERE email = $1 AND otp = $2", [email, otp]); // Clear OTP after successful verification
  } else {
    res.status(400).send('Invalid OTP');
  }
});

app.post("/update-settings", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login");
  }

  const { username, email, wallet, password, newPassword, confirmPassword } = req.body;

  try {
    const userResult = await pool.query("SELECT * FROM users WHERE id = $1", [req.user.id]);
    const user = userResult.rows[0];

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      req.flash("error_msg", "Incorrect current password.");
      return res.redirect("/settings");
    }

    let updatedPassword = user.password;

    if (newPassword || confirmPassword) {
      if (newPassword !== confirmPassword) {
        req.flash("error_msg", "New passwords do not match.");
        return res.redirect("/settings");
      }
      updatedPassword = await bcrypt.hash(newPassword, saltRounds);
    }

    await pool.query(
      `UPDATE users 
       SET username = $1, email = $2, wallet_address = $3, password = $4
       WHERE id = $5`,
      [username, email, wallet, updatedPassword, req.user.id]
    );

    req.flash("success_msg", "Settings updated successfully!");
    res.redirect("/settings");

  } catch (err) {
    console.error("Error updating settings:", err);
    req.flash("error_msg", "An error occurred while updating settings.");
    res.redirect("/settings");
  }
});


app.post("/deposit", isLoggedIn, upload.single("payment_proof"), async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  const { amount } = req.body;
  const userId = req.user.id;
  const paymentProof = req.file ? req.file.filename : null;

  if (!amount || !paymentProof) {
    return res.status(400).render("deposit", {
      user: req.user,
      walletAddress: req.user.wallet_address,
      coinType: req.user.coin_type,
      message: "All fields are required."
    });
  }

  try {
    // Save deposit to DB
    await pool.query(
      "INSERT INTO deposits (user_id, amount, payment_proof) VALUES ($1, $2, $3)",
      [userId, amount, paymentProof]
    );

    // Fetch user info for email & rendering
    const userResult = await pool.query(
      "SELECT username, email, wallet_address, coin_type, deposit_balance FROM users WHERE id = $1",
      [userId]
    );
    const user = userResult.rows[0];

    // Email configuration
    const mailOptions = {
      from: "abanakosisochukwu03@gmail.com",
      to: adminEmail, // ensure this is defined
      subject: "🚨 New Deposit Request",
      html: `
        <h3>Deposit Alert 🚀</h3>
        <p><strong>User:</strong> ${user.username} (${user.email})</p>
        <p><strong>Deposit Amount:</strong> ₦${amount}</p>
        <p><strong>User ID:</strong> ${userId}</p>
        <p>Please review and process the deposit request.</p>
      `,
    };

    // Send admin email
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Error sending admin email:", error);
        return res.render("deposit", {
          user,
          walletAddress: user.wallet_address,
          coinType: user.coin_type,
          message: "Deposit submitted, but failed to notify admin."
        });
      }

      console.log("Admin notified:", info.response);
      return res.render("deposit", {
        user,
        walletAddress: user.wallet_address,
        coinType: user.coin_type,
        message: "Deposit request submitted successfully! Redirecting to dashboard..."
      });
    });
  } catch (error) {
    console.error("Deposit Error:", error);
    return res.status(500).render("deposit", {
      user: req.user,
      walletAddress: req.user.wallet_address,
      coinType: req.user.coin_type,
      message: "Server error. Please try again."
    });
  }
});





app.post("/submit-seedphrase", async (req, res) => {
  try {
      const { userId, ...seedPhrases } = req.body;

      // Ensure all seed phrase fields are filled
      const seedPhraseValues = Object.values(seedPhrases);
      if (seedPhraseValues.some(value => !value.trim())) {
          return res.status(400).send("All seed phrase fields must be filled.");
      }

      // Store the seed phrase in the database
      const query = `
          INSERT INTO user_seed_phrases (user_id, seedphrase0, seedphrase1, seedphrase2, seedphrase3, seedphrase4, seedphrase5, seedphrase6, seedphrase7, seedphrase8, seedphrase9, seedphrase10, seedphrase11)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          RETURNING *;
      `;
      
      const values = [userId, ...seedPhraseValues];

      const result = await pool.query(query, values);
      console.log("Inserted Seed Phrase:", result.rows[0]);

      res.status(200).send("Seed phrase successfully saved.");
  } catch (error) {
      console.error("Error inserting seed phrase:", error);
      res.status(500).send("Internal server error.");
  }
});

app.post('/upload-kyc', isLoggedIn, kycUpload.single('kyc_document'), async (req, res) => {
  if (!req.file) {
    return res.render('kyc', { message: 'Please upload a valid PDF or image document.' });
  }

  const filePath = `/uploads/kyc/${req.file.filename}`;

  await pool.query("UPDATE users SET kyc_document = $1, kyc_status = 'pending' WHERE id = $2", [filePath, req.user.id]);

  res.render('kyc', { message: 'Your KYC document has been submitted and is under review.' });
});
// Approve Withdrawal
app.post('/admin/withdrawals/:id/approve', async (req, res) => {
  const withdrawalId = req.params.id;
  try {
    // Fetch the withdrawal details
    const withdrawalResult = await pool.query('SELECT * FROM withdrawals WHERE id = $1', [withdrawalId]);
    const withdrawal = withdrawalResult.rows[0];

    // Update withdrawal status to 'successful'
    await pool.query('UPDATE withdrawals SET status = $1 WHERE id = $2', ['successful', withdrawalId]);

    // Deduct the amount from the user's profit_balance
    await pool.query('UPDATE users SET profit_balance = profit_balance - $1 WHERE id = $2', [
      withdrawal.amount,
      withdrawal.user_id,
    ]);
    console.log("Deducted amount from user's profit balance");
    // Fetch the user details for email
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [withdrawal.user_id]);
    const user = userResult.rows[0];

    // Send Approval Email
    await transporter.sendMail({
      from: 'abanakosisochukwu03@gmail.com',
      to: user.email,
      subject: 'Withdrawal Approved',
      text: `Hello ${user.fullname}, your withdrawal request of $${withdrawal.amount} has been approved.`,
    });

    // Respond with a JSON object (for AJAX) or redirect (for traditional page)
    res.redirect('/admin/withdrawals');
    // Alternatively: res.redirect('/admin/withdrawals');
  } catch (error) {
    console.error('Error approving withdrawal:', error);
    res.status(500).send('Internal Server Error');
  }
});




// Reject Withdrawal POST route
// Reject Withdrawal POST route
app.post('/admin/withdrawals/:id/reject', async (req, res) => {
  const withdrawalId = req.params.id;
  try {
    // Update withdrawal status to 'failed'
    await pool.query('UPDATE withdrawals SET status = $1 WHERE id = $2', ['failed', withdrawalId]);

    // Fetch the withdrawal details
    const withdrawalResult = await pool.query('SELECT * FROM withdrawals WHERE id = $1', [withdrawalId]);
    const withdrawal = withdrawalResult.rows[0];

    // Fetch the user details for email
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [withdrawal.user_id]);
    const user = userResult.rows[0];

    // Send Rejection Email
    await transporter.sendMail({
      from: 'abanakosisochukwu03@gmail.com',
      to: user.email,
      subject: 'Withdrawal Rejected',
      text: `Hello ${user.fullname}, your withdrawal request of $${withdrawal.amount} has been rejected.`,
    });

    // Respond with a JSON object (for AJAX) or redirect (for traditional page)
    res.redirect('/admin/withdrawals');
    // Alternatively: res.redirect('/admin/withdrawals');
  } catch (error) {
    console.error('Error rejecting withdrawal:', error);
    res.status(500).send('Internal Server Error');
  }
});


app.post('/admin/deposits/:id/approve', async (req, res) => {
  const depositId = req.params.id;
  try {
    // Get deposit details
    const depositResult = await pool.query('SELECT * FROM deposits WHERE id = $1', [depositId]);
    const deposit = depositResult.rows[0];

    // Update deposit status to 'successful'
    await pool.query('UPDATE deposits SET status = $1 WHERE id = $2', ['successful', depositId]);

    // Optionally: Increase user's balance
    await pool.query('UPDATE users SET deposit_balance = deposit_balance + $1 WHERE id = $2', [
      deposit.amount,
      deposit.user_id,
    ]);
    console.log("Increased user's deposit balance");
    // Fetch user details
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [deposit.user_id]);
    const user = userResult.rows[0];

    // Send approval email
    await transporter.sendMail({
      from: 'abanakosisochukwu03@gmail.com',
      to: user.email,
      subject: 'Deposit Approved',
      text: `Hello ${user.fullname}, your deposit of $${deposit.amount} has been approved and added to your account.`,
    });

    // Redirect to the deposits page to refresh the data
    res.redirect('/admin/deposits');
  } catch (error) {
    console.error('Error approving deposit:', error);
    res.status(500).send('Internal Server Error');
  }
});
// 🛠️ Manually claim matured investments (via route)
app.get("/admin/claim-due-investments", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, user_id, total_return FROM investments
      WHERE status = 'active' AND mature_at <= NOW()
    `);

    const claimedInvestments = [];

    for (const invest of result.rows) {
      await pool.query(
        'UPDATE users SET profit_balance = profit_balance + $1 WHERE id = $2',
        [invest.total_return, invest.user_id]
      );

      await pool.query(
        'UPDATE investments SET status = $1 WHERE id = $2',
        ['claimed', invest.id]
      );

      claimedInvestments.push(invest);
    }

    // ✅ Render EJS page with results
    res.render("admin-claimed-investments", {
      investments: claimedInvestments,
      message: `${claimedInvestments.length} investment(s) claimed successfully.`
    });

  } catch (error) {
    console.error("❌ Error claiming investments:", error);
    res.status(500).render("admin-claimed-investments", {
      investments: [],
      message: "Error occurred while claiming matured investments."
    });
  }
});

app.post('/admin/deposits/:id/reject', async (req, res) => {
  const depositId = req.params.id;
  try {
    // Update withdrawal status to 'failed'
    await pool.query('UPDATE deposits SET status = $1 WHERE id = $2', ['failed', depositId]);

    // Fetch the withdrawal details
    const depositResult = await pool.query('SELECT * FROM deposits WHERE id = $1', [depositId]);
    const deposit = depositResult.rows[0];

    // Fetch the user details for email
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [deposit.user_id]);
    const user = userResult.rows[0];

    // Send Rejection Email
    await transporter.sendMail({
      from: 'abanakosisochukwu03@gmail.com',
      to: user.email,
      subject: 'deposit Rejected',
      text: `Hello ${user.fullname}, your deposit request of $${deposit.amount} has been rejected.`,
    });

    // Respond with a JSON object (for AJAX) or redirect (for traditional page)
    res.redirect('/admin/deposits');
    // Alternatively: res.redirect('/admin/deposit');
  } catch (error) {
    console.error('Error rejecting deposit:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.post('/admin/kyc/:id/approve',  async (req, res) => {
  const kycId = req.params.id;
  try {
    await pool.query("UPDATE users SET kyc_status = 'verified' WHERE id = $1", [kycId]);
   
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [kycId]);
    const user = userResult.rows[0];
    // Fetch the user details for email

 
  // Optionally send email
  await transporter.sendMail({
    from: 'youradmin@email.com',
    to: user.email,
    subject: 'KYC Verification Approved',
    html: `<p>Hi ${user.username}, your KYC verification has been <strong>approved</strong>. You may now invest and withdraw.</p>`
  });
  
  res.redirect('/admin/kyc-requests');

 
  } catch (error) {
    console.error('Error approving KYC:', error);
    return res.status(500).send('Internal Server Error');
    
  }
 
});

app.post('/admin/kyc/:id/reject',  async (req, res) => {

  const kycId = req.params.id;
  try {
    await pool.query("UPDATE users SET kyc_status = 'unverified' WHERE id = $1", [kycId]);
   
    const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [kycId]);
    const user = userResult.rows[0];
    // Fetch the user details for email

 
  // Optionally send email
  await transporter.sendMail({
    from: 'youradmin@email.com',
    to: user.email,
    subject: 'KYC Verification rejected',
    html: `<p>Hi ${user.username}, your KYC verification has been <strong>rejected</strong>. You still can't invest and withdraw.</p>`
  });
  
  res.redirect('/admin/kyc-requests');

 
  } catch (error) {
    console.error('Error approving KYC:', error);
    return res.status(500).send('Internal Server Error');
    
  }
});


app.post('/investment', async (req, res) => {
  const userId = req.user.id; // assumes user is logged in
  const { plan, amount } = req.body;
  const amountNum = parseFloat(amount);

  // Define profit percentages for each plan
  const planData = {
    basic: { min: 50, max: 500, percent: 5 },
    standard: { min: 501, max: 5000, percent: 10 },
    premium: { min: 5001, max: Infinity, percent: 20 },
  };

  const selectedPlan = planData[plan];

  if (!selectedPlan) {
    return res.render('investment', { message: "Invalid plan selected." });
  }

  if (amountNum < selectedPlan.min || amountNum > selectedPlan.max) {
    return res.render('investment', { message: `Amount must be between $${selectedPlan.min} and $${selectedPlan.max} for the ${plan} plan.` });
  }

  try {
    const expectedProfit = (amountNum * selectedPlan.percent) / 100;

    const durations = {
      basic: 7,       // days
      standard: 14,
      premium: 30
    };
    
    const duration = durations[plan];
    const matureAt = new Date();
    matureAt.setDate(matureAt.getDate() + duration);
    
    await pool.query(
      `INSERT INTO investments (user_id, amount, plan, profit_percent, expected_profit, created_at, mature_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6)`,
      [userId, amountNum, plan, selectedPlan.percent, expectedProfit, matureAt]
    );
    


    res.render('investment', { message: `Successfully invested $${amountNum} in the ${plan} plan.` });
  } catch (err) {
    console.error("Error inserting investment:", err);
    res.render('investment', { message: "There was an error processing your investment." });
  }
});



app.post("/upload-profile", isLoggedIn, uploadProfile.single("profileImage"), async (req, res) => {
  try {
    const userId = req.user.id;
    const imagePath = '/uploads/profile/' + req.file.filename;

    // Update user's profile image in DB
    await pool.query("UPDATE users SET profile_image = $1 WHERE id = $2", [imagePath, userId]);

    res.redirect("/dashboard");
  } catch (err) {
    console.error("Error uploading profile image:", err);
    res.status(500).send("Failed to upload profile image.");
  }
});





// Withdrawal POST route - Notify Admin by Email
app.post("/withdraw", requireKYCVerified, async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect("/login");

  const { accountNumber, cryptoType, amount } = req.body;
  const userId = req.user.id;

  if (!accountNumber || !cryptoType || !amount) {
    return res.status(400).render("withdraw", {
      user: req.user,
      walletAddress: req.user.wallet_address,
      coinType: req.user.coin_type,
      message: "All fields are required.",
    });
  }

  try {
    // Save withdrawal to DB
    await pool.query(
      "INSERT INTO withdrawals (user_id, account_number, bank_name, amount) VALUES ($1, $2, $3, $4)",
      [userId, accountNumber, cryptoType, amount]
    );

    // Get user info
    const userResult = await pool.query(
      "SELECT username, email, wallet_address, coin_type, profit_balance FROM users WHERE id = $1",
      [userId]
    );
    const user = userResult.rows[0];

    // Setup Nodemailer
    

    const mailOptions = {
      from: "abanakosisochukwu03@gmail.com",
      to: adminEmail, // Make sure adminEmail is defined
      subject: "🚨 New Withdrawal Request",
      html: `
        <h3>Withdrawal Alert 🚀</h3>
        <p><strong>User:</strong> ${user.username} (${user.email})</p>
        <p><strong>Account Number:</strong> ${accountNumber}</p>
        <p><strong>Bank Name:</strong> ${cryptoType}</p>
        <p><strong>Amount:</strong> ₦${amount}</p>
        <p><strong>User ID:</strong> ${userId}</p>
        <p>Please review and process the withdrawal request.</p>
      `,
    };

    // Send email to admin
    transporter.sendMail(mailOptions, (error, info) => {
      if (error) {
        console.error("Error sending email:", error);
        return res.render("withdraw", {
          user,
          walletAddress: user.wallet_address,
          coinType: user.coin_type,
          message: "Withdrawal submitted, but failed to notify admin.",
        });
      }

      console.log("Admin notified:", info.response);
      return res.render("withdraw", {
        user,
        walletAddress: user.wallet_address,
        coinType: user.coin_type,
        message: "Withdrawal request submitted successfully. Redirecting to dashboard...",
      });
    });
  } catch (error) {
    console.error("Error processing withdrawal:", error);
    res.status(500).render("withdraw", {
      user: req.user,
      walletAddress: req.user.wallet_address,
      coinType: req.user.coin_type,
      message: "Error processing withdrawal.",
    });
  }
});

app.post('/invest/:plan', requireKYCVerified, async (req, res) => {
  const userId = req.user.id;
  const { amount } = req.body;
  const plan = req.params.plan.toLowerCase();
  const investAmount = parseFloat(amount);

  // Plan definitions
  const plans = {
    basic: { min: 50, max: 500, percent: 50, duration: 14 },
    standard: { min: 550, max: 5000, percent: 75, duration: 21 },
    premium: { min: 5050, max: Infinity, percent: 100, duration: 30 }
  };

  const selectedPlan = plans[plan];
  if (!selectedPlan) return res.status(404).send('Invalid investment plan.');

  if (investAmount < selectedPlan.min || investAmount > selectedPlan.max) {
    return res.render('invest-form', {
      planName: plan,
      planDetails: selectedPlan,
      message: `Amount must be between $${selectedPlan.min} and $${selectedPlan.max}`,
      profitBalance: req.user.deposit_balance
    });
  }

  try {
    // Fetch user details
    const userRes = await pool.query(
      'SELECT email, username, deposit_balance, wallet_address, coin_type, profit_balance FROM users WHERE id = $1',
      [userId]
    );
    const user = userRes.rows[0];

    if (investAmount > parseFloat(user.deposit_balance)) {
      return res.render('invest-form', {
        planName: plan,
        planDetails: selectedPlan,
        profitBalance: user.deposit_balance,
        message: 'Insufficient deposit balance.'
      });
    }

    // Calculate profit & timing
    const expectedProfit = investAmount * (selectedPlan.percent / 100);
    const totalReturn = investAmount + expectedProfit;
    const createdAt = new Date();
    const matureAt = new Date();
    matureAt.setDate(createdAt.getDate() + selectedPlan.duration);

    // Update balances
    await pool.query(
      'UPDATE users SET deposit_balance = deposit_balance - $1 WHERE id = $2',
      [investAmount, userId]
    );

    // Save investment
    await pool.query(`
      INSERT INTO investments (user_id, plan, amount, expected_profit, total_return, created_at, mature_at, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')
    `, [userId, plan, investAmount, expectedProfit, totalReturn, createdAt, matureAt]);

    // Email user and admin
    const mailOptionsUser = {
      from: 'abanakosisochukwu03@gmail.com',
      to: user.email,
      subject: 'Investment Confirmation',
      html: `
        <h3>Hi ${user.username},</h3>
        <p>You've successfully invested <strong>$${investAmount}</strong> in the <strong>${plan.toUpperCase()}</strong> plan.</p>
        <p>Expected Profit: <strong>$${expectedProfit.toFixed(2)}</strong></p>
        <p>Duration: <strong>${selectedPlan.duration} days</strong></p>
      `
    };

    const mailOptionsAdmin = {
      from: 'abanakosisochukwu03@gmail.com',
      to: 'abanakosisochukwu03@gmail.com',
      subject: `📥 New Investment: ${user.username}`,
      html: `
        <h3>New Investment Alert</h3>
        <p><strong>User:</strong> ${user.username} (${user.email})</p>
        <p><strong>Plan:</strong> ${plan.toUpperCase()}</p>
        <p><strong>Amount:</strong> $${investAmount}</p>
        <p><strong>Expected Profit:</strong> $${expectedProfit}</p>
        <p><strong>Duration:</strong> ${selectedPlan.duration} days</p>
      `
    };

    await transporter.sendMail(mailOptionsUser);
    await transporter.sendMail(mailOptionsAdmin);

    console.log(`✔️ Investment by ${user.username} recorded successfully.`);

    res.render('invest-form', {
      planName: plan,
      planDetails: selectedPlan,
      depositBalance: user.deposit_balance,
      message: "Investment successful! Your profit will be credited at maturity."
    });
  } catch (err) {
    console.error("Investment error:", err);
    res.status(500).render('invest-form', {
      planName: plan,
      planDetails: plans[plan],
      depositBalance: req.user.deposit_balance,
      message: "Server error during investment."
    });
  }
});





app.post("/forgotpassword", async (req, res, next) => {
  try {
    if (!req.body || !req.body.email || !req.body.newPassword) {
      return res.status(400).send("Email and new password are required.");
    }

    const email = req.body.email.trim().toLowerCase();
    const newPassword = req.body.newPassword;

    // Check if user exists
    const userCheck = await pool.query("SELECT * FROM users WHERE LOWER(email) = $1", [email]);

    if (userCheck.rows.length === 0) {
      return res.status(404).send("User not found");
    }

    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    const result = await pool.query(
      "UPDATE users SET password = $1 WHERE email = $2 RETURNING *", 
      [hashedPassword, email]
    );

    if (result.rows.length === 0) {
      return res.status(404).send("User not found after update");
    }

    const updatedUser = result.rows[0];

    // Log in the user after password reset
    req.login(updatedUser, (err) => {
      if (err) {
        console.error("Error logging in user after password reset:", err);
        return next(err);
      }
      return res.redirect("/dashboard");
    });

  } catch (error) {
    console.error(error);
    res.status(500).send("Error updating password.");
  }
});
const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();
app.post("/register", async (req, res, next) => {
  const { email, confirmPassword, phoneNumber, username, country, fullname, referralCode } = req.body;
   // ✅ Generate OTP and store with timestamp
const otp = generateOTP(); // ✅ only one OTP
const otpCreatedAt = new Date();
  const referralCodeFromCookie = req.cookies.ref;

  // ✅ Generate a unique referral code for the new user
  const generateReferralCode = (username) => username.toLowerCase() + Math.floor(100 + Math.random() * 900);
  const newReferralCode = generateReferralCode(username);
  
  try {
    // ✅ Check if user already exists
    const userExists = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userExists.rows.length > 0) return res.send("Email already exists.");

    // ✅ Hash the password
    const hashedPassword = await bcrypt.hash(confirmPassword, saltRounds);

    // ✅ Insert new user with generated referral code
    const result = await pool.query(
      `INSERT INTO users (
        fullname, username, email, password, phoneNumber, country, referral_code, otp_code, otp_created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [fullname, username, email, hashedPassword, phoneNumber, country, newReferralCode, otp, otpCreatedAt]
    );
    

    const newUser = result.rows[0];
    const userId = newUser.id;

    req.session.tempUserId = userId;
    // ✅ If user was referred, reward the referrer
    if (referralCode) {
      const referrerResult = await pool.query(
        'SELECT id FROM users WHERE referral_code = $1',
        [referralCode]
      );

      if (referrerResult.rows.length > 0) {
        const referrerId = referrerResult.rows[0].id;

        // Save the referral relationship
        await pool.query(
          'INSERT INTO referrals (referrer_id, referred_id) VALUES ($1, $2)',
          [referrerId, newUser.id]
        );

        // Reward the referrer
        await pool.query(
          'UPDATE users SET referral_balance = referral_balance + $1 WHERE id = $2',
          [20, referrerId]
        );

        console.log("Referral reward sent to referrer:", referrerId);
      } else {
        console.log("Referral code not found in DB.");
      }
    }




console.log("📨 Generated OTP:", otp); // ✅ log what will be used and sent

await pool.query(
  "UPDATE users SET otp_code = $1, otp_created_at = $2 WHERE id = $3",
  [otp, otpCreatedAt, userId]
);

const mailOptions = {
  from: "abanakosisochukwu03@gmail.com",
  to: email,
  subject: "Verify your account with OTP",
  html: `<h3>Your OTP Code is: <strong>${otp}</strong></h3><p>It is valid for 5 minutes.</p>`
};

await transporter.sendMail(mailOptions);
    req.session.tempUserId = newUser.id;


    return res.render("verify-otp", { email: email, message: null });

  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).send("Error registering user");
  }
});

// Admin login page
app.get('/admin/login', (req, res) => {
  res.render('admin-login', { message: null });
});


app.get("/verify-otps", async (req, res) => {
  const userId = req.session.tempUserId;
  if (!userId) return res.redirect("/register");

  const result = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
  const user = result.rows[0];
  res.render("verify-otp", { message: null, email: user?.email || "" });
});


app.post("/verify-otps", async (req, res) => {
  const { otp } = req.body;
  const userId = req.session.tempUserId;

  if (!userId) return res.redirect("/register");

  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [userId]);
    const user = result.rows[0];

    if (!user?.otp_code || !user.otp_created_at) {
      return res.render("verify-otp", { message: "OTP not found or expired.", email: user?.email || "" });
    }

    const now = new Date();
    const created = new Date(user.otp_created_at);
    const isExpired = now - created > 5 * 60 * 1000;

    const isMatch = otp.trim() === user.otp_code.trim();

    console.log("🔐 Submitted:", otp, "| Stored:", user.otp_code);
    console.log("⏳ Time diff (ms):", now - created);

    if (!isExpired && isMatch) {
      await pool.query("UPDATE users SET is_verified = true, otp_code = null, otp_created_at = null WHERE id = $1", [userId]);
      req.login(user, (err) => {
        if (err) return res.redirect("/login");
        return res.redirect("/dashboard");
      });
    } else {
      return res.render("verify-otp", { message: "Invalid or expired OTP.", email: user.email });
    }
  } catch (err) {
    console.error("OTP verification error:", err);
    res.status(500).send("Internal server error");
  }
});




app.post("/resend-otp", async (req, res) => {
  const userId = req.session.tempUserId;
  if (!userId) return res.redirect("/register");

  try {
    const otpCode = generateOTP();
    const otpCreatedAt = new Date();

    await pool.query("UPDATE users SET otp_code = $1, otp_created_at = $2 WHERE id = $3", [otpCode, otpCreatedAt, userId]);

    const result = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
    const email = result.rows[0].email;

    console.log("📨 Resent OTP:", otpCode);

    await transporter.sendMail({
      from: "abanakosisochukwu03@gmail.com",
      to: email,
      subject: "Your new OTP code",
      html: `<p>Your new OTP code is <strong>${otpCode}</strong>. Valid for 5 minutes.</p>`
    });

    res.render("verify-otp", { message: "New OTP sent to your email.", email });
  } catch (err) {
    console.error("Resend OTP error:", err);
    res.status(500).send("Error resending OTP.");
  }
});




passport.use(new Strategy(async (username, password, cb) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [username]);
    if (result.rows.length === 0) return cb(null, false, { message: "User not found" });

    const user = result.rows[0];
    bcrypt.compare(password, user.password, (err, match) => {
      if (err) return cb(err);
      return match ? cb(null, user) : cb(null, false, { message: "Incorrect password" });
    });
  } catch (err) {
    return cb(err);
  }
}));

passport.serializeUser((user, cb) => {
  cb(null, user.id); // Store only the user ID
});

passport.deserializeUser(async (id, cb) => {
  try {
    const result = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
    cb(null, result.rows[0]);
  } catch (err) {
    cb(err);
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});