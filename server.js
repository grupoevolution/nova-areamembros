const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================================================
// MIDDLEWARE
// =============================================================================
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
    fs.mkdirSync('uploads');
}

// =============================================================================
// DATABASE SETUP
// =============================================================================
const db = new sqlite3.Database('database.db');

// Initialize database tables
db.serialize(() => {
    // Products table
    db.run(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            description TEXT,
            banner_url TEXT,
            main_video TEXT,
            access_url TEXT,
            buy_url TEXT,
            price REAL,
            category TEXT DEFAULT 'meus_produtos',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Product media table (for gallery)
    db.run(`
        CREATE TABLE IF NOT EXISTS product_media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            product_id INTEGER,
            type TEXT CHECK(type IN ('image', 'video')),
            url TEXT NOT NULL,
            order_index INTEGER DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
        )
    `);

    // Admin users table
    db.run(`
        CREATE TABLE IF NOT EXISTS admin_users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Insert default admin user (username: admin, password: admin123)
    db.run(`
        INSERT OR IGNORE INTO admin_users (username, password) 
        VALUES ('admin', '$2b$10$rVzF8E.qJOqVcqGhQQ7bHe8KJrZfYzK3L9mKnC6eC9kG7LwH8vJYG')
    `);

    // Insert some sample data if table is empty
    db.get("SELECT COUNT(*) as count FROM products", (err, row) => {
        if (!err && row.count === 0) {
            const sampleProducts = [
                {
                    name: "Whatsapp Da Fabi",
                    description: "Clique no botão abaixo e fale com a Fabaine no seu Whatsapp particular",
                    banner_url: "https://files.catbox.moe/i6sfiz.png",
                    main_video: "https://e-volutionn.com/wp-content/uploads/2025/07/download-1.mp4",
                    access_url: "https://wa.me/5511975768554?text=Oi%20Fabi%2C%20vim%20pelo%20APP",
                    category: "meus_produtos"
                },
                {
                    name: "Pack Premium Exclusivo",
                    description: "Conteúdo premium exclusivo para membros VIP. Acesso a lives privadas e materiais únicos.",
                    banner_url: "https://images.unsplash.com/photo-1494790108755-2616c78d9f14?w=400&h=600&fit=crop",
                    main_video: "https://www.w3schools.com/html/mov_bbb.mp4",
                    buy_url: "https://hotmoney.space/",
                    price: 147.00,
                    category: "mais_vendidos"
                }
            ];

            sampleProducts.forEach((product, index) => {
                db.run(`
                    INSERT INTO products (name, description, banner_url, main_video, access_url, buy_url, price, category)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `, [product.name, product.description, product.banner_url, product.main_video, 
                   product.access_url, product.buy_url, product.price, product.category], function(err) {
                    if (!err && index === 0) {
                        // Add sample gallery for first product
                        const galleryItems = [
                            { type: 'image', url: 'https://e-volutionn.com/wp-content/uploads/2025/07/IMG_7978.jpg', order_index: 0 },
                            { type: 'image', url: 'https://e-volutionn.com/wp-content/uploads/2025/07/IMG_7975.jpg', order_index: 1 },
                            { type: 'video', url: 'https://e-volutionn.com/wp-content/uploads/2025/05/AMOSTRA-01.mp4', order_index: 2 }
                        ];
                        
                        galleryItems.forEach(item => {
                            db.run(`
                                INSERT INTO product_media (product_id, type, url, order_index)
                                VALUES (?, ?, ?, ?)
                            `, [this.lastID, item.type, item.url, item.order_index]);
                        });
                    }
                });
            });
        }
    });
});

// =============================================================================
// FILE UPLOAD CONFIGURATION
// =============================================================================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 100 * 1024 * 1024 // 100MB limit
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|webm/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Apenas imagens e vídeos são permitidos!'));
        }
    }
});

// =============================================================================
// API ROUTES - PRODUCTS
// =============================================================================

// Get all products with their media
app.get('/api/products', (req, res) => {
    const query = `
        SELECT p.*, 
               GROUP_CONCAT(
                   json_object('type', pm.type, 'url', pm.url, 'order_index', pm.order_index)
                   ORDER BY pm.order_index
               ) as gallery_json
        FROM products p 
        LEFT JOIN product_media pm ON p.id = pm.product_id 
        GROUP BY p.id 
        ORDER BY p.created_at DESC
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
        }
        
        const products = rows.map(row => {
            const product = { ...row };
            
            // Parse gallery JSON
            if (product.gallery_json) {
                try {
                    const galleryItems = product.gallery_json.split(',').map(item => JSON.parse(item));
                    product.gallery = galleryItems.sort((a, b) => a.order_index - b.order_index);
                } catch (e) {
                    product.gallery = [];
                }
            } else {
                product.gallery = [];
            }
            
            delete product.gallery_json;
            return product;
        });
        
        res.json({ success: true, products });
    });
});

// Get single product
app.get('/api/products/:id', (req, res) => {
    const productId = req.params.id;
    
    db.get('SELECT * FROM products WHERE id = ?', [productId], (err, product) => {
        if (err) {
            return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
        }
        
        if (!product) {
            return res.status(404).json({ success: false, error: 'Produto não encontrado' });
        }
        
        // Get product media
        db.all('SELECT * FROM product_media WHERE product_id = ? ORDER BY order_index', [productId], (err, media) => {
            if (err) {
                return res.status(500).json({ success: false, error: 'Erro interno do servidor' });
            }
            
            product.gallery = media;
            res.json({ success: true, product });
        });
    });
});

// Create new product
app.post('/api/products', upload.fields([
    { name: 'banner', maxCount: 1 },
    { name: 'main_video', maxCount: 1 },
    { name: 'gallery', maxCount: 10 }
]), (req, res) => {
    const { name, description, access_url, buy_url, price, category } = req.body;
    
    if (!name) {
        return res.status(400).json({ success: false, error: 'Nome é obrigatório' });
    }
    
    let banner_url = null;
    let main_video = null;
    
    if (req.files.banner) {
        banner_url = `/uploads/${req.files.banner[0].filename}`;
    }
    
    if (req.files.main_video) {
        main_video = `/uploads/${req.files.main_video[0].filename}`;
    }
    
    const query = `
        INSERT INTO products (name, description, banner_url, main_video, access_url, buy_url, price, category)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    db.run(query, [name, description, banner_url, main_video, access_url, buy_url, price, category || 'meus_produtos'], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, error: 'Erro ao criar produto' });
        }
        
        const productId = this.lastID;
        
        // Add gallery items
        if (req.files.gallery) {
            req.files.gallery.forEach((file, index) => {
                const isVideo = /\.(mp4|mov|avi|webm)$/i.test(file.originalname);
                const type = isVideo ? 'video' : 'image';
                const url = `/uploads/${file.filename}`;
                
                db.run(`
                    INSERT INTO product_media (product_id, type, url, order_index)
                    VALUES (?, ?, ?, ?)
                `, [productId, type, url, index]);
            });
        }
        
        res.json({ success: true, productId, message: 'Produto criado com sucesso!' });
    });
});

// Update product
app.put('/api/products/:id', upload.fields([
    { name: 'banner', maxCount: 1 },
    { name: 'main_video', maxCount: 1 },
    { name: 'gallery', maxCount: 10 }
]), (req, res) => {
    const productId = req.params.id;
    const { name, description, access_url, buy_url, price, category } = req.body;
    
    if (!name) {
        return res.status(400).json({ success: false, error: 'Nome é obrigatório' });
    }
    
    // Get current product to preserve existing files if not updated
    db.get('SELECT * FROM products WHERE id = ?', [productId], (err, currentProduct) => {
        if (err || !currentProduct) {
            return res.status(404).json({ success: false, error: 'Produto não encontrado' });
        }
        
        let banner_url = currentProduct.banner_url;
        let main_video = currentProduct.main_video;
        
        if (req.files.banner) {
            banner_url = `/uploads/${req.files.banner[0].filename}`;
        }
        
        if (req.files.main_video) {
            main_video = `/uploads/${req.files.main_video[0].filename}`;
        }
        
        const query = `
            UPDATE products 
            SET name = ?, description = ?, banner_url = ?, main_video = ?, 
                access_url = ?, buy_url = ?, price = ?, category = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `;
        
        db.run(query, [name, description, banner_url, main_video, access_url, buy_url, price, category, productId], function(err) {
            if (err) {
                console.error(err);
                return res.status(500).json({ success: false, error: 'Erro ao atualizar produto' });
            }
            
            // Update gallery if new files provided
            if (req.files.gallery) {
                // Delete existing gallery
                db.run('DELETE FROM product_media WHERE product_id = ?', [productId], (err) => {
                    if (!err) {
                        // Add new gallery items
                        req.files.gallery.forEach((file, index) => {
                            const isVideo = /\.(mp4|mov|avi|webm)$/i.test(file.originalname);
                            const type = isVideo ? 'video' : 'image';
                            const url = `/uploads/${file.filename}`;
                            
                            db.run(`
                                INSERT INTO product_media (product_id, type, url, order_index)
                                VALUES (?, ?, ?, ?)
                            `, [productId, type, url, index]);
                        });
                    }
                });
            }
            
            res.json({ success: true, message: 'Produto atualizado com sucesso!' });
        });
    });
});

// Delete product
app.delete('/api/products/:id', (req, res) => {
    const productId = req.params.id;
    
    // Delete product (cascade will handle media)
    db.run('DELETE FROM products WHERE id = ?', [productId], function(err) {
        if (err) {
            console.error(err);
            return res.status(500).json({ success: false, error: 'Erro ao deletar produto' });
        }
        
        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: 'Produto não encontrado' });
        }
        
        res.json({ success: true, message: 'Produto deletado com sucesso!' });
    });
});

// =============================================================================
// API ROUTES - ADMIN AUTH
// =============================================================================

// Simple admin login (você pode melhorar com JWT)
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    
    if (username === 'admin' && password === 'admin123') {
        res.json({ success: true, message: 'Login realizado com sucesso!' });
    } else {
        res.status(401).json({ success: false, error: 'Credenciais inválidas' });
    }
});

// =============================================================================
// STATIC FILES & PWA
// =============================================================================

// Serve manifest.json
app.get('/manifest.json', (req, res) => {
    const manifest = {
        "name": "Membros VIP",
        "short_name": "VIP App",
        "description": "Área de Membros VIP - Acesso Exclusivo",
        "start_url": "/",
        "display": "standalone",
        "background_color": "#000000",
        "theme_color": "#E50914",
        "icons": [
            {
                "src": "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgdmlld0JveD0iMCAwIDEyOCAxMjgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CiAgPHJlY3Qgd2lkdGg9IjEyOCIgaGVpZ2h0PSIxMjgiIGZpbGw9IiNFNTA5MTQiLz4KICA8dGV4dCB4PSI2NCIgeT0iNjgiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmb250LXNpemU9IjIwIiBmb250LXdlaWdodD0iYm9sZCI+VklQPC90ZXh0Pgo8L3N2Zz4=",
                "type": "image/svg+xml",
                "sizes": "128x128"
            }
        ]
    };
    
    res.json(manifest);
});

// Service Worker
app.get('/sw.js', (req, res) => {
    const swContent = `
        const CACHE_NAME = 'vip-app-v1';
        const urlsToCache = [
            '/',
            '/manifest.json'
        ];

        self.addEventListener('install', event => {
            event.waitUntil(
                caches.open(CACHE_NAME)
                    .then(cache => cache.addAll(urlsToCache))
            );
        });

        self.addEventListener('fetch', event => {
            event.respondWith(
                caches.match(event.request)
                    .then(response => {
                        if (response) {
                            return response;
                        }
                        return fetch(event.request);
                    })
            );
        });
    `;
    
    res.setHeader('Content-Type', 'application/javascript');
    res.send(swContent);
});

// Serve admin panel
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve main app
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// =============================================================================
// ERROR HANDLING
// =============================================================================
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(400).json({ success: false, error: 'Arquivo muito grande. Máximo 100MB.' });
        }
    }
    
    console.error(error);
    res.status(500).json({ success: false, error: 'Erro interno do servidor' });
});

// =============================================================================
// START SERVER
// =============================================================================
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log(`📱 App principal: http://localhost:${PORT}`);
    console.log(`⚙️  Painel admin: http://localhost:${PORT}/admin`);
    console.log(`📊 API: http://localhost:${PORT}/api/products`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n👋 Fechando servidor...');
    db.close((err) => {
        if (err) {
            console.error(err.message);
        }
        console.log('✅ Banco de dados fechado.');
        process.exit(0);
    });
});
