const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  console.error('Error:', err);

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    const message = 'Invalid token';
    error = { message, statusCode: 401 };
  }

  if (err.name === 'TokenExpiredError') {
    const message = 'Token expired';
    error = { message, statusCode: 401 };
  }

  // Prisma errors
  if (err.code === 'P2002') {
    const message = 'Duplicate field value entered';
    error = { message, statusCode: 400 };
  }

  if (err.code === 'P2025') {
    const message = 'Record not found';
    error = { message, statusCode: 404 };
  }

  // Prisma connection errors
  if (err.code === 'P1001') {
    const message = 'Database connection error';
    error = { message, statusCode: 503 };
  }

  if (err.code === 'P1008') {
    const message = 'Database operation timed out';
    error = { message, statusCode: 504 };
  }

  // Validation errors (from express-validator or custom validation)
  if (err.name === 'ValidationError' || err.type === 'validation') {
    const message = err.message || 'Validation error';
    error = { message, statusCode: 400 };
  }

  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = { errorHandler };
