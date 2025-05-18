import express, { Request, Response } from 'express';

const app = express();
const PORT = process.env.PORT || 3000;

// Define routes
app.get('/todo', (req: Request, res: Response) => {
    res.status(200).json({ message: 'GET /todo' });
});

app.get('/todo/:itemId', (req: Request, res: Response) => {
    res.status(200).json({ message: `GET /todo/${req.params.itemId}` });
});

app.post('/todo/:itemId/completeTask', (req: Request, res: Response) => {
    res.status(200).json({ message: `POST /todo/${req.params.itemId}/completeTask` });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});