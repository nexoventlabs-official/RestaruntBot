import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Platform, StatusBar
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

const DELIVERY_GREEN = '#267E3E';

export default function MapNavigationScreen({ route, navigation }) {
  const { destination, destinationAddress, customerName } = route.params;
  const [currentLocation, setCurrentLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [heading, setHeading] = useState(0);
  const [routeInfo, setRouteInfo] = useState({ duration: '', distance: '' });
  const webViewRef = useRef(null);
  const locationSubscription = useRef(null);
  const lastLocation = useRef(null);

  useEffect(() => {
    startLocationTracking();
    return () => {
      if (locationSubscription.current) {
        locationSubscription.current.remove();
      }
    };
  }, []);

  const calculateBearing = (lat1, lon1, lat2, lon2) => {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const toDeg = (rad) => (rad * 180) / Math.PI;
    const dLon = toRad(lon2 - lon1);
    const y = Math.sin(dLon) * Math.cos(toRad(lat2));
    const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
              Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
    let bearing = toDeg(Math.atan2(y, x));
    return (bearing + 360) % 360;
  };

  const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3;
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const startLocationTracking = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setError('Location permission denied');
        setLoading(false);
        return;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.BestForNavigation,
      });
      
      const initialCoords = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
      
      setCurrentLocation(initialCoords);
      lastLocation.current = initialCoords;
      setLoading(false);

      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 1000,
          distanceInterval: 5,
        },
        (newLocation) => {
          const newCoords = {
            latitude: newLocation.coords.latitude,
            longitude: newLocation.coords.longitude,
          };
          
          let newHeading = heading;
          if (lastLocation.current) {
            const distance = getDistance(
              lastLocation.current.latitude, lastLocation.current.longitude,
              newCoords.latitude, newCoords.longitude
            );
            if (distance > 3) {
              newHeading = calculateBearing(
                lastLocation.current.latitude, lastLocation.current.longitude,
                newCoords.latitude, newCoords.longitude
              );
              setHeading(newHeading);
            }
          }
          
          setCurrentLocation(newCoords);
          lastLocation.current = newCoords;
          
          if (webViewRef.current) {
            webViewRef.current.postMessage(JSON.stringify({
              type: 'updateLocation',
              coords: newCoords,
              heading: newHeading,
            }));
          }
        }
      );
    } catch (err) {
      console.error('Location error:', err);
      setError('Failed to get location');
      setLoading(false);
    }
  };

  const getMapHTML = () => {
    const destLat = destination?.latitude || 0;
    const destLng = destination?.longitude || 0;
    const originLat = currentLocation?.latitude || 0;
    const originLng = currentLocation?.longitude || 0;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.css" />
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; width: 100%; overflow: hidden; }
    #map { height: 100%; width: 100%; background: #E8E4E0; }
    
    .leaflet-routing-container { display: none !important; }
    .leaflet-control-attribution { display: none !important; }
    
    .leaflet-container {
      background: #E8E4E0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    
    /* Prevent flicker on zoom */
    .leaflet-tile {
      filter: saturate(0.3) brightness(1.05) contrast(1.1);
      opacity: 1 !important;
      visibility: visible !important;
      backface-visibility: hidden;
      -webkit-backface-visibility: hidden;
      transform: translateZ(0);
      -webkit-transform: translateZ(0);
    }
    
    .leaflet-tile-loaded { 
      opacity: 1 !important; 
    }
    
    .leaflet-tile-container {
      opacity: 1 !important;
      visibility: visible !important;
    }
    
    /* Keep old tiles visible during zoom */
    .leaflet-zoom-hide {
      visibility: visible !important;
      opacity: 1 !important;
    }
    
    .leaflet-proxy {
      display: none;
    }
    
    .leaflet-zoom-animated {
      will-change: transform;
    }
    
    .leaflet-zoom-anim .leaflet-zoom-animated {
      transition: transform 0.25s cubic-bezier(0, 0, 0.25, 1) !important;
    }
    
    .leaflet-pan-anim .leaflet-tile {
      transition: none !important;
    }
    
    /* Prevent tile fade during zoom */
    .leaflet-fade-anim .leaflet-tile,
    .leaflet-fade-anim .leaflet-popup,
    .leaflet-zoom-anim .leaflet-tile {
      opacity: 1 !important;
      transition: none !important;
    }
    
    .leaflet-tile-pane {
      will-change: transform;
      transform: translateZ(0);
    }
    
    /* Delivery partner marker - simple green circle */
    .delivery-marker {
      position: relative;
      width: 40px;
      height: 40px;
    }
    
    .delivery-pulse {
      position: absolute;
      top: 0;
      left: 0;
      width: 40px;
      height: 40px;
      background: rgba(38, 126, 62, 0.25);
      border-radius: 50%;
      animation: deliveryPulse 2s ease-out infinite;
    }
    
    @keyframes deliveryPulse {
      0% { transform: scale(1); opacity: 0.6; }
      100% { transform: scale(2); opacity: 0; }
    }
    
    .delivery-dot {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 18px;
      height: 18px;
      background: #267E3E;
      border: 3px solid #fff;
      border-radius: 50%;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    
    /* Home destination marker */
    .home-marker {
      position: relative;
      width: 80px;
      height: 80px;
    }
    
    .home-circle {
      position: absolute;
      width: 80px;
      height: 80px;
      background: rgba(76, 175, 80, 0.2);
      border: 2px solid rgba(76, 175, 80, 0.5);
      border-radius: 50%;
      top: 0;
      left: 0;
    }
    
    .home-pin {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 36px;
      height: 36px;
      background: #1a1a1a;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    
    .home-pin svg {
      width: 20px;
      height: 20px;
    }
    
    /* Info panel */
    .info-panel {
      position: absolute;
      top: 100px;
      left: 16px;
      right: 16px;
      background: #fff;
      border-radius: 16px;
      padding: 16px 20px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.12);
      z-index: 1000;
      display: none;
    }
    
    .info-title {
      font-size: 18px;
      font-weight: 700;
      color: #1a1a1a;
      margin-bottom: 8px;
    }
    
    .info-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    
    .info-badge {
      background: #f5f5f5;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 14px;
      font-weight: 600;
      color: #1a1a1a;
    }
    
    .refresh-btn {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-left: auto;
      cursor: pointer;
      display: none;
    }
    
    /* Zoom controls */
    .zoom-controls {
      position: absolute;
      right: 16px;
      top: 50%;
      transform: translateY(-50%);
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 2px 10px rgba(0,0,0,0.1);
      z-index: 1000;
      overflow: hidden;
    }
    
    .zoom-btn {
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      border: none;
      background: #fff;
      font-size: 20px;
      color: #333;
    }
    
    .zoom-btn:first-child {
      border-bottom: 1px solid #eee;
    }
    
    .zoom-btn:active {
      background: #f5f5f5;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  
  <div class="info-panel">
    <div class="info-title">Order is on the way</div>
    <div class="info-row">
      <div class="info-badge">
        <span id="duration">Calculating...</span> • <span id="distance"></span>
      </div>
      <div class="refresh-btn" onclick="refreshRoute()">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2">
          <path d="M23 4v6h-6M1 20v-6h6"/>
          <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
        </svg>
      </div>
    </div>
  </div>
  
  <div class="zoom-controls">
    <button class="zoom-btn" onclick="map.zoomIn()">+</button>
    <button class="zoom-btn" onclick="map.zoomOut()">−</button>
  </div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="https://unpkg.com/leaflet-routing-machine@3.2.12/dist/leaflet-routing-machine.js"></script>
  <script>
    const originLat = ${originLat};
    const originLng = ${originLng};
    const destLat = ${destLat};
    const destLng = ${destLng};
    let currentHeading = 0;
    let routingControl = null;

    // Tile cache for preloading
    const tileCache = new Map();
    const preloadedImages = [];

    // Initialize map
    const map = L.map('map', {
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: false,
      zoomAnimation: true,
      zoomAnimationThreshold: 10,
      markerZoomAnimation: true,
      preferCanvas: true,
      updateWhenZooming: true,
      updateWhenIdle: false,
      keepBuffer: 12,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 120
    }).setView([originLat, originLng], 16);

    // Zomato-style gray map tiles with aggressive caching
    const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      minZoom: 10,
      subdomains: 'abcd',
      updateWhenIdle: false,
      updateWhenZooming: true,
      keepBuffer: 15,
      crossOrigin: true,
      useCache: true,
      cacheMaxAge: 86400000,
      className: 'cached-tile'
    }).addTo(map);

    // Preload tiles for zoom levels around current view
    function preloadTiles(centerLat, centerLng, currentZoom) {
      // Preload more zoom out levels to prevent flicker
      const zoomLevels = [currentZoom - 4, currentZoom - 3, currentZoom - 2, currentZoom - 1, currentZoom, currentZoom + 1, currentZoom + 2];
      const subdomains = ['a', 'b', 'c', 'd'];
      
      zoomLevels.forEach(zoom => {
        if (zoom < 10 || zoom > 19) return;
        
        // Calculate tile coordinates for center point
        const n = Math.pow(2, zoom);
        const centerTileX = Math.floor((centerLng + 180) / 360 * n);
        const centerTileY = Math.floor((1 - Math.log(Math.tan(centerLat * Math.PI / 180) + 1 / Math.cos(centerLat * Math.PI / 180)) / Math.PI) / 2 * n);
        
        // Larger grid for zoom out levels
        const gridSize = zoom < currentZoom ? 4 : 3;
        
        for (let dx = -gridSize; dx <= gridSize; dx++) {
          for (let dy = -gridSize; dy <= gridSize; dy++) {
            const tileX = centerTileX + dx;
            const tileY = centerTileY + dy;
            const subdomain = subdomains[(tileX + tileY) % 4];
            const url = \`https://\${subdomain}.basemaps.cartocdn.com/light_all/\${zoom}/\${tileX}/\${tileY}.png\`;
            
            if (!tileCache.has(url)) {
              const img = new Image();
              img.crossOrigin = 'anonymous';
              img.onload = () => tileCache.set(url, 'loaded');
              img.src = url;
              preloadedImages.push(img);
              tileCache.set(url, 'loading');
            }
          }
        }
      });
    }

    // Preload tiles for route between origin and destination
    function preloadRouteTiles() {
      const midLat = (originLat + destLat) / 2;
      const midLng = (originLng + destLng) / 2;
      
      // Preload at multiple zoom levels for smooth zoom out
      [12, 13, 14, 15, 16, 17].forEach(zoom => {
        preloadTiles(originLat, originLng, zoom);
        preloadTiles(destLat, destLng, zoom);
        preloadTiles(midLat, midLng, zoom);
      });
    }

    // Start preloading immediately
    setTimeout(preloadRouteTiles, 100);

    // Preload more tiles when map moves or zooms
    let preloadTimeout;
    map.on('moveend zoomend', function() {
      clearTimeout(preloadTimeout);
      preloadTimeout = setTimeout(() => {
        const center = map.getCenter();
        const zoom = map.getZoom();
        preloadTiles(center.lat, center.lng, Math.round(zoom));
      }, 100);
    });

    // Preload on zoom start to prepare tiles
    map.on('zoomstart', function() {
      const center = map.getCenter();
      const zoom = map.getZoom();
      preloadTiles(center.lat, center.lng, Math.round(zoom));
    });

    // Simple green circle marker for delivery partner
    const deliveryMarkerSVG = \`
      <div class="delivery-marker">
        <div class="delivery-pulse"></div>
        <div class="delivery-dot"></div>
      </div>
    \`;

    // Home marker SVG
    const homeSVG = \`
      <div class="home-marker">
        <div class="home-circle"></div>
        <div class="home-pin">
          <svg viewBox="0 0 24 24" fill="white">
            <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/>
          </svg>
        </div>
      </div>
    \`;

    // Create icons
    const deliveryIcon = L.divIcon({
      className: '',
      html: deliveryMarkerSVG,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });

    const homeIcon = L.divIcon({
      className: '',
      html: homeSVG,
      iconSize: [80, 80],
      iconAnchor: [40, 40],
    });

    // Add markers
    let riderMarker = L.marker([originLat, originLng], { 
      icon: deliveryIcon,
      zIndexOffset: 1000
    }).addTo(map);
    
    L.marker([destLat, destLng], { icon: homeIcon }).addTo(map);

    // Create route
    function createRoute(startLat, startLng) {
      if (routingControl) {
        map.removeControl(routingControl);
      }
      
      routingControl = L.Routing.control({
        waypoints: [
          L.latLng(startLat, startLng),
          L.latLng(destLat, destLng)
        ],
        routeWhileDragging: false,
        addWaypoints: false,
        draggableWaypoints: false,
        fitSelectedRoutes: false,
        showAlternatives: false,
        lineOptions: {
          styles: [
            { color: '#2563EB', opacity: 1, weight: 5 }
          ]
        },
        createMarker: () => null
      }).addTo(map);

      routingControl.on('routesfound', function(e) {
        const route = e.routes[0];
        const dist = route.summary.totalDistance;
        const time = route.summary.totalTime;
        
        const distanceText = dist >= 1000 ? (dist/1000).toFixed(1) + ' km' : Math.round(dist) + ' m';
        const durationText = time >= 3600 
          ? Math.floor(time/3600) + 'h ' + Math.round((time%3600)/60) + ' min' 
          : Math.round(time/60) + ' mins';
        
        document.getElementById('distance').textContent = distanceText;
        document.getElementById('duration').textContent = durationText;
        
        // Send route info to React Native
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'routeInfo',
            duration: durationText,
            distance: distanceText
          }));
        }
      });
    }

    function refreshRoute() {
      const pos = riderMarker.getLatLng();
      createRoute(pos.lat, pos.lng);
    }

    createRoute(originLat, originLng);

    // Fit bounds
    map.fitBounds([[originLat, originLng], [destLat, destLng]], { padding: [100, 100] });

    // Smooth animation for package marker
    function animateMarker(marker, newLat, newLng, newHeading, duration = 500) {
      const startPos = marker.getLatLng();
      const startTime = performance.now();
      
      function animate(currentTime) {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const ease = 1 - Math.pow(1 - progress, 3);
        
        const lat = startPos.lat + (newLat - startPos.lat) * ease;
        const lng = startPos.lng + (newLng - startPos.lng) * ease;
        
        marker.setLatLng([lat, lng]);
        
        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      }
      requestAnimationFrame(animate);
    }

    // Handle messages
    function handleMessage(event) {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'updateLocation') {
          animateMarker(riderMarker, data.coords.latitude, data.coords.longitude, data.heading || currentHeading);
          if (Math.random() < 0.2) createRoute(data.coords.latitude, data.coords.longitude);
          map.panTo([data.coords.latitude, data.coords.longitude], { animate: true, duration: 0.5 });
        } else if (data.type === 'recenter') {
          map.setView([data.coords.latitude, data.coords.longitude], 17, { animate: true });
        }
      } catch (e) {}
    }

    document.addEventListener('message', handleMessage);
    window.addEventListener('message', handleMessage);
  </script>
</body>
</html>
    `;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color={DELIVERY_GREEN} />
        <Text style={styles.loadingText}>Getting your location...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="location-outline" size={64} color="#E23744" />
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={startLocationTracking}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-down" size={28} color="#1a1a1a" />
        </TouchableOpacity>
        <View style={styles.headerInfo}>
          <Text style={styles.headerTitle}>Order is on the way</Text>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>
              {routeInfo.duration && routeInfo.distance 
                ? `${routeInfo.duration} • ${routeInfo.distance}` 
                : 'Calculating...'}
            </Text>
          </View>
        </View>
        <View style={{ width: 40 }} />
      </View>

      {/* Map */}
      <WebView
        ref={webViewRef}
        source={{ html: getMapHTML() }}
        style={styles.map}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        cacheEnabled={true}
        cacheMode="LOAD_CACHE_ELSE_NETWORK"
        startInLoadingState={true}
        onMessage={(event) => {
          try {
            const data = JSON.parse(event.nativeEvent.data);
            if (data.type === 'routeInfo') {
              setRouteInfo({ duration: data.duration, distance: data.distance });
            }
          } catch (e) {}
        }}
        renderLoading={() => (
          <View style={styles.webviewLoading}>
            <ActivityIndicator size="large" color={DELIVERY_GREEN} />
          </View>
        )}
      />

      {/* Bottom Card */}
      <View style={styles.bottomCard}>
        <View style={styles.addressRow}>
          <View style={styles.addressIcon}>
            <Ionicons name="home" size={18} color="#fff" />
          </View>
          <View style={styles.addressInfo}>
            <Text style={styles.addressLabel}>Delivering to</Text>
            <Text style={styles.addressText} numberOfLines={1}>
              {destinationAddress || customerName || 'Customer Address'}
            </Text>
          </View>
        </View>
        <TouchableOpacity 
          style={styles.recenterBtn}
          onPress={() => {
            if (webViewRef.current && currentLocation) {
              webViewRef.current.postMessage(JSON.stringify({
                type: 'recenter', coords: currentLocation
              }));
            }
          }}
        >
          <Ionicons name="locate" size={20} color="#1a1a1a" />
        </TouchableOpacity>
      </View>
    </View>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    padding: 20,
  },
  errorText: {
    marginTop: 16,
    fontSize: 16,
    color: '#E23744',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 20,
    backgroundColor: '#E23744',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 12,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight + 8 : 50,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: '#fff',
    zIndex: 100,
  },
  backButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerInfo: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1a1a1a',
  },
  headerBadge: {
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    marginTop: 4,
  },
  headerBadgeText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  map: {
    flex: 1,
  },
  webviewLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#E8E4E0',
  },
  bottomCard: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 34 : 20,
    left: 16,
    right: 16,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  addressRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  addressIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  addressInfo: {
    flex: 1,
    marginLeft: 12,
  },
  addressLabel: {
    fontSize: 12,
    color: '#888',
  },
  addressText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
    marginTop: 2,
  },
  recenterBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
