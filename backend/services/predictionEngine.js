/**
 * Mathematical Prediction & Wait-Time Engine
 */

// Calculate estimated wait time in minutes
const calculateWaitTime = (queueCount, activeCounters, avgServiceTimeMin) => {
    if (activeCounters <= 0) return 0;
    return Math.round((queueCount * avgServiceTimeMin) / activeCounters);
  };
  
  // Determine crowd level status
  const getCrowdStatus = (waitTimeMin) => {
    if (waitTimeMin >= 45) return 'HIGH';
    if (waitTimeMin >= 20) return 'MODERATE';
    return 'LOW';
  };
  
  // Generate 8-hour forecast (9 AM to 4 PM) based on live queue state & historical data
  const generateForecast = (currentQueueCount, activeCounters, avgServiceTimeMin, historicalRecords = []) => {
    const hours = [9, 10, 11, 12, 13, 14, 15, 16];
    
    // Map historical data into quick lookup object
    const historyMap = {};
    historicalRecords.forEach(record => {
      historyMap[record.hour] = record.recordedQueue;
    });
  
    let bestTime = { hour: 14, queue: 999 };
  
    const forecast = hours.map((hour) => {
      const historicalBaseline = historyMap[hour] || 35;
      
      // Weighted blend: 60% live queue trends, 40% historical baseline
      const predictedQueue = Math.round((currentQueueCount * 0.6) + (historicalBaseline * 0.4));
      const estimatedWaitMin = calculateWaitTime(predictedQueue, activeCounters, avgServiceTimeMin);
  
      if (predictedQueue < bestTime.queue) {
        bestTime = { hour, queue: predictedQueue };
      }
  
      return {
        hour: `${hour > 12 ? hour - 12 : hour}:00 ${hour >= 12 ? 'PM' : 'AM'}`,
        rawHour: hour,
        predictedQueue,
        estimatedWaitMin,
        crowdLevel: getCrowdStatus(estimatedWaitMin)
      };
    });
  
    return {
      forecast,
      bestTimeWindow: `${bestTime.hour > 12 ? bestTime.hour - 12 : bestTime.hour}:00 ${bestTime.hour >= 12 ? 'PM' : 'AM'} - ${bestTime.hour + 1 > 12 ? bestTime.hour + 1 - 12 : bestTime.hour + 1}:00 ${bestTime.hour + 1 >= 12 ? 'PM' : 'AM'}`
    };
  };
  
  module.exports = {
    calculateWaitTime,
    getCrowdStatus,
    generateForecast
  };