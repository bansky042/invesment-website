CREATE TABLE user_seed_phrases (
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    seedphrase0 TEXT NOT NULL,
    seedphrase1 TEXT NOT NULL,
    seedphrase2 TEXT NOT NULL,
    seedphrase3 TEXT NOT NULL,
    seedphrase4 TEXT NOT NULL,
    seedphrase5 TEXT NOT NULL,
    seedphrase6 TEXT NOT NULL,
    seedphrase7 TEXT NOT NULL,
    seedphrase8 TEXT NOT NULL,
    seedphrase9 TEXT NOT NULL,
    seedphrase10 TEXT NOT NULL,
    seedphrase11 TEXT NOT NULL,
    PRIMARY KEY (user_id, seedphrase0) -- Assuming seedphrase0 is unique for each user
);
