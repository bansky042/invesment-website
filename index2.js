
app.post("/forgotpassword", async (req, res) => {
    const email = req.body.email;
const newPassword = req.body.newPassword;

  try {
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);
    await pool.query("UPDATE users SET password = $1 WHERE email = $2", [hashedPassword, email]);
    res.status(200).send('Password updated successfully');
  } catch (error) {
    console.log(error);
    res.status(500).send('Error updating password');
  }
}
);


app.post("/insertWalletAddress", async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.redirect("/login"); // Redirect to login if not authenticated
  }

  const userId = req.user.id; // Get the authenticated user's ID
  const walletAddress = req.body.walletAddress; // Get the wallet address from the request body

  if (!walletAddress) {
    return res.status(400).send("Wallet address is required.");
  }

  try {
    await pool.query("INSERT INTO users (id, wallet_address) VALUES ($1, $2)", [userId, walletAddress]);
    res.send("Wallet address saved successfully!");
  } catch (error) {
    console.error("Error saving wallet address:", error);
    res.status(500).send("Error saving wallet address.");
  }
});