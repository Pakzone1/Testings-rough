from flask import Flask, render_template, request, redirect, url_for, session, jsonify, send_file, make_response, Response
from functools import wraps
import json
import os
import logging
import subprocess
import signal
import shutil
import time
from datetime import datetime
import sys
from config import config
from io import StringIO
import csv

app = Flask(__name__)
app.secret_key = config.SECRET_KEY
app.config.from_object(config)
logging.basicConfig(level=logging.DEBUG)

# Get instance directory from current working directory
INSTANCE_DIR = os.getcwd()
INSTANCE_QR_PATH = os.path.join(INSTANCE_DIR, 'qr_code.png')

# Global variables
bot_process = None
bot_connected = False
bot_error = None


def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'logged_in' not in session:
            return redirect(url_for('login', next=request.url))
        return f(*args, **kwargs)
    return decorated_function


@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        if (username == config.AUTH_CREDENTIALS['username'] and
                password == config.AUTH_CREDENTIALS['password']):
            session['logged_in'] = True
            return redirect(url_for('index'))
        return render_template('login.html', error=config.MESSAGES['error']['invalid_credentials'])
    return render_template('login.html')


@app.route('/logout')
def logout():
    session.pop('logged_in', None)
    return redirect(url_for('login'))


@app.route('/')
@login_required
def index():
    commands = {
        'admin': {
            'title': '👑 Admin Commands',
            'description': 'Commands available to administrators',
            'commands': [
                {'name': '!!set-key',
                    'description': 'Update the assistant key for AI functionality'},
                {'name': '!!add-mod',
                    'description': 'Add a new moderator to help manage the bot'},
                {'name': '!!remove-mod', 'description': 'Remove an existing moderator'},
                {'name': '!!list-mods',
                    'description': 'Display a list of all current moderators'},
                {'name': '!!clear-threads',
                    'description': 'Clear all conversation threads'},
                {'name': '!!show-menu', 'description': 'Display the admin command menu'},
                {'name': '!!start', 'description': 'Start or resume the bot'},
                {'name': '!!pause', 'description': 'Temporarily pause the bot'},
                {'name': '!!no-assist',
                    'description': 'Disable AI assistance for a specific number'},
                {'name': '!!ai-assist',
                    'description': 'Enable AI assistance for a specific number'}
            ]
        },
        'moderator': {
            'title': '🛡️ Moderator Commands',
            'description': 'Commands available to moderators',
            'commands': [
                {'name': '!!show-menu',
                    'description': 'Display the moderator command menu'},
                {'name': '!!start', 'description': 'Start or resume the bot'},
                {'name': '!!pause', 'description': 'Temporarily pause the bot'},
                {'name': '!!no-assist',
                    'description': 'Disable AI assistance for a specific number'},
                {'name': '!!ai-assist',
                    'description': 'Enable AI assistance for a specific number'}
            ]
        },
        'user': {
            'title': '👤 User Commands',
            'description': 'Commands available to all users',
            'commands': [
                {'name': '!!show-menu', 'description': 'Display the user command menu'},
                {'name': '!!help',
                    'description': 'Show available commands and their descriptions'}
            ]
        }
    }
    return render_template('index.html', commands=commands)


@app.route('/orders')
@login_required
def orders():
    return render_template('orders.html')


@app.route('/api/orders', methods=['GET'])
@login_required
def get_orders():
    try:
        app.logger.debug(f"Opening file at path: {
                         config.PATHS['delivery_data']}")
        app.logger.debug(f"Current working directory: {os.getcwd()}")
        with open(config.PATHS['delivery_data'], 'r') as f:
            data = json.load(f)
            app.logger.debug(f"Successfully loaded data with {
                             len(data['orders'])} orders")
        return jsonify(data['orders'])
    except Exception as e:
        app.logger.error(f"Error in get_orders: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/orders', methods=['POST'])
@login_required
def add_order():
    try:
        order_data = request.json
        with open(config.PATHS['delivery_data'], 'r') as f:
            data = json.load(f)

        order = {
            'id': f"ORD{int(time.time())}",
            'customerName': order_data.get('customerName', 'Not specified'),
            'customerNumber': order_data['customerNumber'],
            'status': order_data.get('status', 'processing'),
            'details': order_data.get('details', ''),
            'trackingNumber': order_data.get('trackingNumber'),
            'createdAt': datetime.now().isoformat(),
            'updatedAt': datetime.now().isoformat(),
            'estimatedDelivery': order_data.get('estimatedDelivery'),
            'currentLocation': order_data.get('currentLocation', 'Processing')
        }

        data['orders'].append(order)
        with open(config.PATHS['delivery_data'], 'w') as f:
            json.dump(data, f, indent=2)

        return jsonify(order), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/orders/<order_id>', methods=['PUT'])
@login_required
def update_order(order_id):
    try:
        updates = request.json
        with open(config.PATHS['delivery_data'], 'r') as f:
            data = json.load(f)

        order_index = next((i for i, order in enumerate(data['orders'])
                            if order['id'] == order_id), -1)
        if order_index == -1:
            return jsonify({"error": config.MESSAGES['error']['order_not_found']}), 404

        # Ensure customer name is preserved if not in updates
        if 'customerName' not in updates and 'customerName' in data['orders'][order_index]:
            updates['customerName'] = data['orders'][order_index]['customerName']

        data['orders'][order_index].update(updates)
        data['orders'][order_index]['updatedAt'] = datetime.now().isoformat()

        with open(config.PATHS['delivery_data'], 'w') as f:
            json.dump(data, f, indent=2)

        return jsonify(data['orders'][order_index])
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/api/orders/<order_id>', methods=['DELETE'])
@login_required
def delete_order(order_id):
    try:
        with open(config.PATHS['delivery_data'], 'r') as f:
            data = json.load(f)

        data['orders'] = [order for order in data['orders']
                          if order['id'] != order_id]

        with open(config.PATHS['delivery_data'], 'w') as f:
            json.dump(data, f, indent=2)

        return '', 204
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/get_qr_code')
@login_required
def get_qr_code():
    if os.path.exists(INSTANCE_QR_PATH):
        return send_file(INSTANCE_QR_PATH, mimetype='image/png')
    return jsonify({"message": "QR code not available"})


@app.route('/qr_code_exists')
@login_required
def qr_code_exists():
    exists = os.path.exists(INSTANCE_QR_PATH)
    return jsonify({
        "exists": exists,
        "path": INSTANCE_QR_PATH if exists else None,
        "timestamp": int(time.time())
    })


@app.route('/is_bot_ready')
@login_required
def is_bot_ready():
    global bot_connected, bot_process
    is_ready = bot_connected and bot_process is not None and bot_process.poll() is None
    return jsonify({
        "ready": is_ready,
        "connected": bot_connected,
        "process_running": bot_process is not None and bot_process.poll() is None
    })


@app.route('/bot_status')
@login_required
def bot_status():
    global bot_process, bot_connected, bot_error
    qr_exists = os.path.exists(INSTANCE_QR_PATH)
    process_running = bot_process is not None and bot_process.poll() is None

    status = {
        "connected": bot_connected,
        "process_running": process_running,
        "qr_code_exists": qr_exists,
        "error": bot_error,
        "timestamp": int(time.time()),
        "status": "connecting" if qr_exists and not bot_connected else
        "connected" if bot_connected else
        "disconnected" if not process_running else
        "starting"
    }

    return jsonify(status)


@app.route('/set_bot_connected', methods=['POST'])
def set_bot_connected():
    global bot_connected, bot_error
    bot_connected = True
    bot_error = None

    if os.path.exists(INSTANCE_QR_PATH):
        try:
            os.remove(INSTANCE_QR_PATH)
        except Exception as e:
            logging.error(f"Error removing QR code: {e}")

    return jsonify({
        "message": "Bot connection status updated",
        "ready": True,
        "connected": True,
        "error": None
    })


@app.route('/reset_bot')
@login_required
def reset_bot():
    global bot_process, bot_connected

    # Stop existing bot process
    if bot_process is not None and bot_process.poll() is None:
        try:
            if os.name == 'nt':  # Windows
                subprocess.run(['taskkill', '/F', '/T', '/PID',
                               str(bot_process.pid)], check=False)
            else:  # Linux/Mac
                os.kill(bot_process.pid, signal.SIGTERM)
                bot_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            if os.name != 'nt':  # Not needed for Windows as taskkill /F is forceful
                os.kill(bot_process.pid, signal.SIGKILL)
        except Exception as e:
            logging.error(f"Error stopping bot: {e}")
        finally:
            bot_process = None
            time.sleep(2)  # Give Windows time to release file handles

    # Clean up directories with Windows-specific handling
    for cache_dir in [config.PATHS['auth_dir'], config.PATHS['cache_dir']]:
        if os.path.exists(cache_dir):
            max_attempts = 5
            for attempt in range(max_attempts):
                try:
                    if os.name == 'nt':  # Windows
                        # First try to remove read-only attributes
                        for root, dirs, files in os.walk(cache_dir):
                            for fname in files:
                                full_path = os.path.join(root, fname)
                                try:
                                    os.chmod(full_path, 0o666)
                                except:
                                    pass
                    shutil.rmtree(cache_dir, ignore_errors=True)
                    break
                except PermissionError:
                    if attempt < max_attempts - 1:
                        time.sleep(2)  # Longer wait on Windows
                    else:
                        return jsonify({
                            "message": f"Failed to remove {cache_dir}. Please close WhatsApp Web and try again.",
                            "connected": False,
                            "error": True
                        })

    # Remove existing QR code
    if os.path.exists(INSTANCE_QR_PATH):
        try:
            os.remove(INSTANCE_QR_PATH)
        except Exception as e:
            logging.error(f"Error removing QR code: {e}")

    # Start new bot process
    try:
        # Set Windows-specific environment
        env = {**os.environ, **config.BOT_ENV}
        if os.name == 'nt':
            env['PUPPETEER_SKIP_CHROMIUM_DOWNLOAD'] = 'true'

        bot_process = subprocess.Popen(
            ['node', 'index.js'],
            cwd=INSTANCE_DIR,  # Use instance directory
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            universal_newlines=True,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0
        )
        bot_connected = False

        # Wait for process to start and potentially generate QR
        max_wait = 30  # Maximum seconds to wait
        start_time = time.time()

        while time.time() - start_time < max_wait:
            if bot_process.poll() is not None:
                stdout, stderr = bot_process.communicate()
                error_msg = f"Bot failed to start. Error: {stderr}"
                logging.error(error_msg)
                return jsonify({"error": error_msg, "connected": False}), 500

            if os.path.exists(INSTANCE_QR_PATH):
                return jsonify({
                    "message": "Bot reset successfully. QR code is ready for scanning.",
                    "connected": False,
                    "qr_ready": True
                })

            time.sleep(0.5)

        return jsonify({
            "message": "Bot reset successfully but QR code generation is taking longer than expected. Please wait...",
            "connected": False,
            "qr_ready": False
        })

    except Exception as e:
        error_msg = f"Error resetting bot: {str(e)}"
        logging.error(error_msg)
        return jsonify({"error": error_msg, "connected": False}), 500


@app.route('/set_bot_disconnected', methods=['POST'])
def set_bot_disconnected():
    global bot_connected, bot_error
    bot_connected = False

    try:
        data = request.get_json()
        if data and 'error' in data:
            error_message = data['error']
            if 'Cannot read properties' in error_message:
                bot_error = config.MESSAGES['error']['connection_lost']
            elif 'EPERM' in error_message or 'EBUSY' in error_message:
                bot_error = "Session files are locked. Please close any other WhatsApp Web instances and try again."
            else:
                bot_error = error_message
    except Exception as e:
        bot_error = config.MESSAGES['error']['connection_lost']

    return jsonify({
        'message': 'Bot disconnected status updated',
        'connected': False,
        'error': bot_error
    })


@app.route('/start_bot')
@login_required
def start_bot():
    global bot_process, bot_connected

    # If bot is already running, return success
    if bot_process is not None and bot_process.poll() is None:
        return jsonify({"message": "Bot is already running", "connected": bot_connected})

    # Ensure auth directories exist and are accessible
    auth_dir = os.path.join(os.path.dirname(__file__), '.wwebjs_auth')
    cache_dir = os.path.join(os.path.dirname(__file__), '.wwebjs_cache')

    for directory in [auth_dir, cache_dir]:
        if not os.path.exists(directory):
            try:
                os.makedirs(directory, mode=0o777)
            except Exception as e:
                return jsonify({"error": f"Failed to create directory {directory}: {str(e)}"}), 500

    try:
        # Set NODE_ENV to production for better performance
        env = dict(os.environ)
        env['NODE_ENV'] = 'production'
        env['DEBUG'] = '1'  # Enable debug logging

        # Start the bot process with proper environment and pipe configuration
        bot_process = subprocess.Popen(
            ['node', 'index.js'],
            cwd=os.path.dirname(__file__),
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
            universal_newlines=True
        )

        def log_output(pipe, prefix):
            for line in iter(pipe.readline, ''):
                print(f"{prefix}: {line.strip()}")
                logging.info(f"{prefix}: {line.strip()}")

        # Start threads to monitor stdout and stderr
        import threading
        stdout_thread = threading.Thread(target=log_output, args=(
            bot_process.stdout, "Bot output"), daemon=True)
        stderr_thread = threading.Thread(target=log_output, args=(
            bot_process.stderr, "Bot error"), daemon=True)
        stdout_thread.start()
        stderr_thread.start()

        # Give the process time to initialize
        time.sleep(3)

        if bot_process.poll() is not None:
            stdout, stderr = bot_process.communicate()
            error_msg = f"Bot failed to start. Error: {stderr}"
            logging.error(error_msg)
            return jsonify({"error": error_msg}), 500

        # Flush stdout to ensure logs are shown immediately
        sys.stdout.flush()
        return jsonify({"message": "Bot started successfully", "connected": False})

    except Exception as e:
        error_msg = f"Error starting bot: {str(e)}"
        logging.error(error_msg)
        return jsonify({"error": error_msg}), 500


@app.route('/stop_bot')
@login_required
def stop_bot():
    global bot_process, bot_connected

    # Stop the bot if it's running
    if bot_process is not None and bot_process.poll() is None:
        os.kill(bot_process.pid, signal.SIGTERM)
        bot_process.wait()
        bot_process = None
        bot_connected = False
        return jsonify({"message": "Bot stopped successfully", "connected": False})

    return jsonify({"message": "Bot is not running", "connected": False})


@app.route('/api/orders/<order_id>', methods=['GET'])
@login_required
def get_order(order_id):
    try:
        with open(config.PATHS['delivery_data'], 'r') as f:
            data = json.load(f)

        order = next(
            (order for order in data['orders'] if order['id'] == order_id), None)
        if not order:
            return jsonify({"error": "Order not found"}), 404

        return jsonify(order)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route('/download_contacts')
@login_required
def download_contacts():
    try:
        # Read the contacts file
        contacts_file = config.PATHS['contacts']
        if not os.path.exists(contacts_file):
            return jsonify({"error": "No contacts found"}), 404

        with open(contacts_file, 'r') as f:
            contacts_data = json.load(f)

        # Create a CSV in memory
        si = StringIO()
        writer = csv.writer(si)

        # Write headers
        writer.writerow(['Contact ID', 'Name', 'Phone Number'])

        # Write contacts data
        for phone_number, name in contacts_data.items():
            writer.writerow([name, name, phone_number])

        # Create the response
        output = si.getvalue()
        si.close()

        response = make_response(output)
        response.headers['Content-Disposition'] = 'attachment; filename=contacts.csv'
        response.headers['Content-type'] = 'text/csv'

        return response

    except Exception as e:
        logging.error(f"Error downloading contacts: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/orders/export/csv')
@login_required
def export_orders_csv():
    try:
        with open(config.PATHS['delivery_data'], 'r') as f:
            data = json.load(f)

        # Create CSV in memory
        output = StringIO()
        writer = csv.writer(output)

        # Write headers
        headers = ['Customer Name', 'Customer Number', 'Status', 'Current Location',
                   'Order Number', 'Estimated Delivery', 'Details']
        writer.writerow(headers)

        # Write data
        for order in data['orders']:
            writer.writerow([
                order.get('customerName', ''),
                order.get('customerNumber', ''),
                order.get('status', ''),
                order.get('currentLocation', ''),
                order.get('trackingNumber', ''),
                order.get('estimatedDelivery', ''),
                order.get('details', '')
            ])

        # Create response
        output.seek(0)
        return Response(
            output.getvalue(),
            mimetype='text/csv',
            headers={
                'Content-Disposition': f'attachment; filename=orders_{datetime.now().strftime("%Y%m%d")}.csv'
            }
        )
    except Exception as e:
        app.logger.error(f"Error exporting orders to CSV: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route('/api/orders/import/csv', methods=['POST'])
@login_required
def import_orders_csv():
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']
    if not file.filename.endswith('.csv'):
        return jsonify({"error": "File must be a CSV"}), 400

    try:
        # Initialize empty data structure
        data = {'orders': []}

        # Read CSV file
        stream = StringIO(file.stream.read().decode("UTF8"), newline=None)
        csv_reader = csv.DictReader(stream)

        imported_count = 0
        skipped_count = 0
        errors = []

        for row in csv_reader:
            try:
                # Validate required fields
                if not row.get('Customer Number'):
                    skipped_count += 1
                    continue

                order = {
                    'id': f"ORD{int(time.time())}_{imported_count}",
                    'customerName': row.get('Customer Name', 'Not specified'),
                    'customerNumber': row['Customer Number'],
                    'status': row.get('Status', 'processing'),
                    'currentLocation': row.get('Current Location', ''),
                    'trackingNumber': row.get('Order Number', ''),
                    'estimatedDelivery': row.get('Estimated Delivery', ''),
                    'details': row.get('Details', ''),
                    'createdAt': datetime.now().isoformat(),
                    'updatedAt': datetime.now().isoformat()
                }

                data['orders'].append(order)
                imported_count += 1

            except Exception as e:
                errors.append(f"Error on row {
                              imported_count + skipped_count + 1}: {str(e)}")

        if not errors:
            # Only save if there were no errors
            with open(config.PATHS['delivery_data'], 'w') as f:
                json.dump(data, f, indent=2)

            # Return both success message and updated orders
            return jsonify({
                "message": f"Import completed successfully. {imported_count} orders imported, {skipped_count} skipped. Previous data has been overwritten.",
                "orders": data['orders']
            })
        else:
            return jsonify({
                "message": "Import failed due to errors",
                "errors": errors
            }), 400

    except Exception as e:
        app.logger.error(f"Error importing orders from CSV: {str(e)}")
        return jsonify({"error": str(e)}), 500


@app.route('/qr-scan/<phone_number>', methods=['POST'])
def track_qr_scan():
    try:
        phone_number = request.view_args['phone_number']
        scanner_ip = request.remote_addr
        
        # Load the Node.js QR tracking function
        subprocess.run([
            'node', '-e',
            f'require("./qr_manager.js").trackScan("{phone_number}", "{scanner_ip}")'
        ])
        
        return jsonify({"success": True})
    except Exception as e:
        app.logger.error(f"Error tracking QR scan: {str(e)}")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG)
