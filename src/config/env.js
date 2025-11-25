/**
 * Environment Variable Validation
 * Validates required environment variables at application startup
 */

/**
 * Required environment variables for the application
 * Format: { key: 'description' }
 */
const requiredEnvVars = {
  DATABASE_URL: 'PostgreSQL database connection string',
  JWT_SECRET: 'JWT secret key for token signing',
  JWT_REFRESH_SECRET: 'JWT refresh token secret key',
};

/**
 * Optional environment variables with defaults
 * Format: { key: { default: 'value', description: 'description' } }
 */
const optionalEnvVars = {
  PORT: { default: 8001, description: 'Server port' },
  NODE_ENV: { default: 'development', description: 'Node environment' },
  JWT_EXPIRES_IN: { default: '7d', description: 'JWT token expiration' },
  JWT_REFRESH_EXPIRES_IN: { default: '30d', description: 'JWT refresh token expiration' },
};

/**
 * Validate environment variables
 * @throws {Error} If required environment variables are missing
 */
function validateEnv() {
  const missingVars = [];
  const warnings = [];

  // Check required environment variables
  for (const [key, description] of Object.entries(requiredEnvVars)) {
    if (!process.env[key] || process.env[key].trim() === '') {
      missingVars.push({ key, description });
    }
  }

  // Check for placeholder values in required vars
  for (const [key, description] of Object.entries(requiredEnvVars)) {
    const value = process.env[key];
    if (value && (
      value.includes('your-') ||
      value.includes('your_') ||
      value === 'localhost' && key === 'DATABASE_URL' ||
      (key.includes('SECRET') && value.length < 32)
    )) {
      warnings.push({
        key,
        description,
        message: `Value appears to be a placeholder. Please set a proper value for ${key}`
      });
    }
  }

  // Set defaults for optional variables
  for (const [key, config] of Object.entries(optionalEnvVars)) {
    if (!process.env[key]) {
      process.env[key] = config.default;
    }
  }

  // Throw error if required variables are missing
  if (missingVars.length > 0) {
    const errorMessage = [
      '❌ Missing required environment variables:',
      ...missingVars.map(({ key, description }) => `   - ${key}: ${description}`),
      '',
      'Please set these variables in your .env file or environment.'
    ].join('\n');
    
    throw new Error(errorMessage);
  }

  // Log warnings for placeholder values (non-blocking)
  if (warnings.length > 0 && process.env.NODE_ENV !== 'test') {
    console.warn('\n⚠️  Environment variable warnings:');
    warnings.forEach(({ key, message }) => {
      console.warn(`   - ${key}: ${message}`);
    });
    console.warn('');
  }

  // Validate JWT secret strength in production
  if (process.env.NODE_ENV === 'production') {
    const jwtSecret = process.env.JWT_SECRET;
    const refreshSecret = process.env.JWT_REFRESH_SECRET;
    
    if (jwtSecret && jwtSecret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters long in production');
    }
    
    if (refreshSecret && refreshSecret.length < 32) {
      throw new Error('JWT_REFRESH_SECRET must be at least 32 characters long in production');
    }
  }

  console.log('✅ Environment variables validated successfully');
}

module.exports = {
  validateEnv,
  requiredEnvVars,
  optionalEnvVars
};

