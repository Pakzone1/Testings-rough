from datetime import timedelta
import os
from dotenv import load_dotenv
load_dotenv()  # Load environment variables first


class Config:
    # Base Configuration
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

    # Flask Configuration
    SECRET_KEY = os.environ.get(
        'SECRET_KEY', 'hgfdsdfghjhgfdrty5434567uyt56uhgfrt6y78765432ertyj')
    SESSION_TYPE = os.environ.get('SESSION_TYPE', 'filesystem')
    PERMANENT_SESSION_LIFETIME = timedelta(
        days=int(os.environ.get('SESSION_LIFETIME_DAYS', 1)))

    # Server Configuration
    HOST = os.environ.get('HOST', '0.0.0.0')
    # Port is loaded from .env file, defaults to 8080 if not set
    PORT = int(os.environ.get('PORT', 8080))
    DEBUG = os.environ.get('DEBUG', '0') == '1'

    # Authentication
    AUTH_CREDENTIALS = {
        'username': os.environ.get('DASHBOARD_USERNAME', 'bot'),
        'password': os.environ.get('DASHBOARD_PASSWORD', 'bot-bot')
    }

    # File Paths
    PATHS = {
        'qr_code': os.path.join(BASE_DIR, 'qr_code.png'),
        'delivery_data': os.path.join(BASE_DIR, 'delivery_data.json'),
        'auth_dir': os.path.join(BASE_DIR, '.wwebjs_auth'),
        'cache_dir': os.path.join(BASE_DIR, '.wwebjs_cache'),
        'contacts': os.path.join(BASE_DIR, 'contacts.json')
    }

    # WhatsApp Bot Configuration
    BOT_ENV = {
        'NODE_ENV': os.environ.get('NODE_ENV', 'production'),
        'DEBUG': os.environ.get('DEBUG', '1')
    }

    # API Response Messages
    MESSAGES = {
        'success': {
            'bot_started': 'Bot started successfully',
            'bot_stopped': 'Bot stopped successfully',
            'bot_reset': 'Bot reset successfully',
            'order_added': 'Order added successfully',
            'order_updated': 'Order updated successfully',
            'order_deleted': 'Order deleted successfully'
        },
        'error': {
            'auth_failed': 'Authentication failed. Please reset the bot and scan the QR code again.',
            'connection_lost': 'WhatsApp connection lost. Please reset the bot and scan the QR code again.',
            'navigation': 'WhatsApp Web was closed or refreshed. Please reset the bot and scan the QR code again.',
            'conflict': 'WhatsApp Web was opened in another window. Please close other sessions and reset the bot.',
            'session_expired': 'Session has expired. Please login again.',
            'invalid_credentials': 'Invalid credentials',
            'order_not_found': 'Order not found',
            'server_error': 'An error occurred. Please try again later.'
        }
    }

    # Order Status Types
    ORDER_STATUS = {
        'pending': 'pending',
        'processing': 'processing',
        'shipped': 'shipped',
        'delivered': 'delivered',
        'cancelled': 'cancelled'
    }


config = Config()
