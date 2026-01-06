import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import axios from 'axios';
import { ArrowRightIcon, ArrowLeftIcon } from './Icons';

const API_URL = 'https://restaruntbot.onrender.com/api/public';

export default function HeroCarousel() {
  const [heroes, setHeroes] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    loadHeroSections();
  }, []);

  const loadHeroSections = async () => {
    try {
      const res = await axios.get(`${API_URL}/hero-sections`);
      setHeroes(res.data);
    } catch (err) {
      console.error('Error loading hero sections:', err);
    } finally {
      setLoading(false);
    }
  };

  const nextSlide = useCallback(() => {
    if (heroes.length > 1) {
      setCurrentIndex((prev) => (prev + 1) % heroes.length);
    }
  }, [heroes.length]);

  const prevSlide = useCallback(() => {
    if (heroes.length > 1) {
      setCurrentIndex((prev) => (prev - 1 + heroes.length) % heroes.length);
    }
  }, [heroes.length]);

  // Auto-slide every 3 seconds
  useEffect(() => {
    if (heroes.length <= 1 || isPaused) return;
    
    const interval = setInterval(nextSlide, 3000);
    return () => clearInterval(interval);
  }, [heroes.length, isPaused, nextSlide]);

  if (loading) {
    return (
      <section className="relative h-screen bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center">
        <div className="animate-pulse text-white text-xl">Loading...</div>
      </section>
    );
  }

  // Fallback hero if no heroes from admin
  if (heroes.length === 0) {
    return (
      <section className="relative h-screen bg-gradient-to-br from-orange-500 via-orange-600 to-red-500 overflow-hidden">
        <div className="absolute inset-0 bg-black/20" />
        <div className="relative h-full max-w-7xl mx-auto px-4 flex items-center">
          <div className="max-w-2xl text-white">
            <h1 className="text-4xl md:text-6xl font-bold mb-4 leading-tight">
              Delicious Food,<br />Delivered Fresh
            </h1>
            <p className="text-lg md:text-xl text-white/90 mb-8">
              Experience the best flavors from our kitchen to your doorstep. Fresh ingredients, amazing taste, quick delivery.
            </p>
            <Link 
              to="/menu" 
              className="inline-flex items-center gap-2 bg-white text-orange-600 px-8 py-4 rounded-full font-semibold hover:bg-orange-50 transition-all shadow-lg hover:shadow-xl hover:scale-105"
            >
              Explore Menu <ArrowRightIcon className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>
    );
  }

  const currentHero = heroes[currentIndex];

  return (
    <section 
      className="relative h-screen overflow-hidden"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      {/* Background Images with Transition */}
      {heroes.map((hero, index) => (
        <div
          key={hero._id}
          className={`absolute inset-0 transition-opacity duration-700 ${
            index === currentIndex ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <img 
            src={hero.image} 
            alt={hero.title}
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent" />
        </div>
      ))}

      {/* Content */}
      <div className="relative h-full max-w-7xl mx-auto px-4 flex items-center">
        <div className="max-w-2xl text-white">
          {currentHero.subtitle && (
            <p className="text-orange-400 font-medium mb-2 tracking-wider uppercase text-sm md:text-base animate-fade-in">
              {currentHero.subtitle}
            </p>
          )}
          <h1 className="text-4xl md:text-6xl font-bold mb-4 leading-tight animate-slide-up">
            {currentHero.title}
          </h1>
          {currentHero.description && (
            <p className="text-lg md:text-xl text-white/90 mb-8 animate-slide-up-delay">
              {currentHero.description}
            </p>
          )}
          <Link 
            to={currentHero.buttonLink || '/menu'} 
            className="inline-flex items-center gap-2 bg-orange-500 text-white px-8 py-4 rounded-full font-semibold hover:bg-orange-600 transition-all shadow-lg hover:shadow-xl hover:scale-105 animate-fade-in-delay"
          >
            {currentHero.buttonText || 'Order Now'} <ArrowRightIcon className="w-5 h-5" />
          </Link>
        </div>
      </div>

      {/* Navigation Arrows */}
      {heroes.length > 1 && (
        <>
          <button
            onClick={prevSlide}
            className="absolute left-4 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white p-3 rounded-full transition-all hover:scale-110"
            aria-label="Previous slide"
          >
            <ArrowLeftIcon className="w-6 h-6" />
          </button>
          <button
            onClick={nextSlide}
            className="absolute right-4 top-1/2 -translate-y-1/2 bg-white/20 hover:bg-white/30 backdrop-blur-sm text-white p-3 rounded-full transition-all hover:scale-110"
            aria-label="Next slide"
          >
            <ArrowRightIcon className="w-6 h-6" />
          </button>
        </>
      )}

      {/* Dots Indicator */}
      {heroes.length > 1 && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex gap-2">
          {heroes.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentIndex(index)}
              className={`w-3 h-3 rounded-full transition-all ${
                index === currentIndex 
                  ? 'bg-orange-500 w-8' 
                  : 'bg-white/50 hover:bg-white/70'
              }`}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      )}

      {/* Progress Bar */}
      {heroes.length > 1 && !isPaused && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
          <div 
            className="h-full bg-orange-500 animate-progress"
            style={{ animationDuration: '3s' }}
          />
        </div>
      )}
    </section>
  );
}
