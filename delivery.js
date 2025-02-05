const config = require('./config');
const { ORDER_STATUS, ERROR_MESSAGES, SUCCESS_MESSAGES } = require('./constants');
const { fileUtils } = require('./utils');
const fs = require('fs');

// Initialize delivery data watcher
let deliveryDataWatcher = null;
let deliveryData = { orders: [] };

function startDeliveryDataWatcher() {
    if (deliveryDataWatcher) {
        deliveryDataWatcher.close();
    }

    try {
        deliveryDataWatcher = fs.watch(config.paths.delivery, (eventType, filename) => {
            if (eventType === 'change' || eventType === 'rename') {
                console.log('Delivery data file changed, reloading...');
                deliveryData = loadDeliveryData();
            }
        });

        deliveryDataWatcher.on('error', (error) => {
            console.error('Error watching delivery data file:', error);
            // Try to restart watcher after a delay
            setTimeout(startDeliveryDataWatcher, 5000);
        });
    } catch (error) {
        console.error('Failed to start delivery data watcher:', error);
    }
}

// Initialize delivery data if it doesn't exist
if (!fs.existsSync(config.paths.delivery)) {
    console.log('Delivery data file not found, creating new one');
    fileUtils.writeJsonFile(config.paths.delivery, { orders: [] });
}

function loadDeliveryData() {
    try {
        // Check if file exists
        if (!fs.existsSync(config.paths.delivery)) {
            console.log('Delivery data file not found, creating new one');
            const emptyData = { orders: [] };
            fileUtils.writeJsonFile(config.paths.delivery, emptyData);
            return emptyData;
        }

        const data = fileUtils.readJsonFile(config.paths.delivery, { orders: [] });
        console.log(`Loaded ${data.orders.length} orders`);
        return data;
    } catch (error) {
        console.error('Error loading delivery data:', error);
        return { orders: [] };
    }
}

function saveDeliveryData(data) {
    try {
        fileUtils.writeJsonFile(config.paths.delivery, data);
        // If file was deleted and recreated, restart the watcher
        if (!deliveryDataWatcher) {
            startDeliveryDataWatcher();
        }
        return true;
    } catch (error) {
        console.error('Error saving delivery data:', error);
        return false;
    }
}

// Start the file watcher when module loads
startDeliveryDataWatcher();
deliveryData = loadDeliveryData();

function addOrder(orderData) {
    const data = loadDeliveryData();
    const order = {
        id: `ORD${Date.now()}`,
        customerNumber: orderData.customerNumber,
        status: orderData.status || ORDER_STATUS.PROCESSING,
        details: orderData.details || '',
        trackingNumber: orderData.trackingNumber,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        estimatedDelivery: orderData.estimatedDelivery,
        currentLocation: orderData.currentLocation || 'Processing',
        ...orderData
    };
    data.orders.push(order);
    saveDeliveryData(data);
    return order;
}

function normalizeStatus(status) {
    if (!status) return 'processing';

    // Convert to lowercase and remove extra spaces
    const normalized = status.toLowerCase().trim();

    // Map all possible variations to standard format
    const statusMap = {
        'processing': 'processing',
        'dhl': 'dhl_warehouse',
        'dhl warehouse': 'dhl_warehouse',
        'dhl_warehouse': 'dhl_warehouse',
        'dhl_ware': 'dhl_warehouse',
        'dhlwarehouse': 'dhl_warehouse',
        'in transit': 'in_transit',
        'in_transit': 'in_transit',
        'intransit': 'in_transit',
        'buffalo': 'buffalo_warehouse',
        'buffalo warehouse': 'buffalo_warehouse',
        'buffalo_warehouse': 'buffalo_warehouse',
        'buffalo_ware': 'buffalo_warehouse',
        'arrived in buffalo': 'buffalo_warehouse',
        'arrived in buffalo warehouse': 'buffalo_warehouse',
        'delivered': 'delivered'
    };

    // Remove all spaces and underscores for comparison
    const cleanStatus = normalized.replace(/[\s_]+/g, '');

    // Find matching status by comparing cleaned versions
    for (const [key, value] of Object.entries(statusMap)) {
        if (key.replace(/[\s_]+/g, '') === cleanStatus) {
            return value;
        }
    }

    return normalized;
}

function formatOrderStatus(order) {
    // Normalize the status
    const normalizedStatus = normalizeStatus(order.status);

    // Map for display text
    const statusDisplay = {
        'processing': 'Processing',
        'dhl_warehouse': 'DHL Warehouse',
        'in_transit': 'In Transit',
        'buffalo_warehouse': 'Arrived in Buffalo Warehouse',
        'delivered': 'Delivered'
    };

    // Get display text or fallback to normalized status in uppercase
    const displayStatus = statusDisplay[normalizedStatus] || normalizedStatus.toUpperCase();

    return `
🚚 *Order Status: ${order.id}*
---------------------------
Name: ${order.customerName || 'Not specified'}
Status: ${displayStatus}
Current Location: ${order.currentLocation}
${order.estimatedDelivery ? `Estimated Delivery: ${order.estimatedDelivery}` : ''}
${order.trackingNumber ? `Tracking Number: ${order.trackingNumber}` : ''}
${order.details ? `\nDetails: ${order.details}` : ''}
---------------------------
Last Updated: ${new Date(order.updatedAt).toLocaleString()}`;
}

function updateOrder(orderId, updates) {
    const data = loadDeliveryData();
    const orderIndex = data.orders.findIndex(order => order.id === orderId);
    if (orderIndex === -1) return null;

    // Normalize status if it's being updated
    if (updates.status) {
        updates.status = normalizeStatus(updates.status);
    }

    data.orders[orderIndex] = {
        ...data.orders[orderIndex],
        ...updates,
        updatedAt: new Date().toISOString()
    };
    saveDeliveryData(data);
    return data.orders[orderIndex];
}

function deleteOrder(orderId) {
    const data = loadDeliveryData();
    const orderIndex = data.orders.findIndex(order => order.id === orderId);
    if (orderIndex === -1) return false;

    data.orders.splice(orderIndex, 1);
    return saveDeliveryData(data);
}

function getOrdersByCustomer(customerNumber) {
    const data = loadDeliveryData();
    return data.orders.filter(order => order.customerNumber === customerNumber);
}

function getOrderById(orderId) {
    const data = loadDeliveryData();
    return data.orders.find(order => order.id === orderId);
}

function getAllOrders() {
    const data = loadDeliveryData();
    return data.orders;
}

module.exports = {
    addOrder,
    updateOrder,
    deleteOrder,
    getOrdersByCustomer,
    getOrderById,
    getAllOrders,
    formatOrderStatus
}; 