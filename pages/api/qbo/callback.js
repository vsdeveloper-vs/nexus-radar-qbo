export default function handler(req, res) {
  const { code, state, realmId } = req.query;

  // Per ora, solo vedere cosa arriva da Intuit
  return res.status(200).json({
    message: "Callback from Intuit received.",
    code,
    state,
    realmId
  });
}
