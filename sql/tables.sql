-- SQL code for creating the necessary tables

-- Users table
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    fullname VARCHAR(100),
    username VARCHAR(50) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    phoneNumber VARCHAR(15),
    country VARCHAR(50),
    referral_code VARCHAR(50) UNIQUE,
    otp_code VARCHAR(6),
    otp_created_at TIMESTAMP,
    kyc_status VARCHAR(20) DEFAULT 'unverified',
    kyc_document TEXT,
    wallet_address TEXT,
    coin_type VARCHAR(50),
    deposit_balance DECIMAL(10, 2) DEFAULT 0,
    profit_balance DECIMAL(10, 2) DEFAULT 0,
    referral_balance DECIMAL(10, 2) DEFAULT 0,
    profile_image TEXT,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Investments table
CREATE TABLE investments (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    amount DECIMAL(10, 2) NOT NULL,
    plan VARCHAR(50),
    profit_percent DECIMAL(5, 2),
    expected_profit DECIMAL(10, 2),
    total_return DECIMAL(10, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    mature_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active'
);

-- Withdrawals table
CREATE TABLE withdrawals (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    account_number VARCHAR(50),
    bank_name VARCHAR(100),
    amount DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Deposits table
CREATE TABLE deposits (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    amount DECIMAL(10, 2) NOT NULL,
    payment_proof TEXT,
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- OTPs table
CREATE TABLE otpss (
    id SERIAL PRIMARY KEY,
    email VARCHAR(100),
    otp VARCHAR(6),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- User Seed Phrases table
CREATE TABLE user_seed_phrases (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    seedphrase0 VARCHAR(100),
    seedphrase1 VARCHAR(100),
    seedphrase2 VARCHAR(100),
    seedphrase3 VARCHAR(100),
    seedphrase4 VARCHAR(100),
    seedphrase5 VARCHAR(100),
    seedphrase6 VARCHAR(100),
    seedphrase7 VARCHAR(100),
    seedphrase8 VARCHAR(100),
    seedphrase9 VARCHAR(100),
    seedphrase10 VARCHAR(100),
    seedphrase11 VARCHAR(100)
);

-- Referrals table
CREATE TABLE referrals (
    id SERIAL PRIMARY KEY,
    referrer_id INT REFERENCES users(id),
    referred_id INT REFERENCES users(id)
);
